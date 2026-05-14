//! Business logic — pure fonksiyonlar test edilebilir, command wrapper'lar
//! DB'den veri çekip pure'lara devreder.

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

use crate::db::models::Transaction;
use crate::error::AppResult;
use crate::services::{binance_rest, cache, coingecko, tcmb, Db};

/* ----------------------------------------------------------------
 * Pure: position summary (avg cost, current balance, realized P/L)
 * ---------------------------------------------------------------- */

#[derive(Debug, Clone, Default, PartialEq)]
pub struct PositionSummary {
    /// Mevcut bakiye (kalan miktar). Negatif olabilir (short pozisyon).
    pub balance: f64,
    /// Ağırlıklı ortalama maliyet — sadece total_cost > 0 olduğunda anlamlı.
    pub avg_cost: f64,
    /// Toplam kalan maliyet (avg_cost * balance).
    pub total_cost: f64,
    /// Tüm satışlardan gerçekleşen kar/zarar (asset para biriminde).
    pub realized_pl: f64,
    /// Toplam satın alınan miktar (lifetime).
    pub total_bought: f64,
    /// Toplam satılan miktar.
    pub total_sold: f64,
    /// Pasif gelir miktarı (stake/temettü/faiz olarak gelen).
    pub passive_income_qty: f64,
    /// USD-locked kalan maliyet (tarihsel kur kilit toplamı).
    /// `Some(x)` = tüm buy tx'lerinin fx_to_usd'si var, USD bazında doğru.
    /// `None` = en az bir buy lock'sız → display tarafı current FX ile fallback yapsın.
    pub total_cost_usd_locked: Option<f64>,
    /// Cost-weighted ortalama tx-level yield (%). Asset.expected_yield_pct
    /// yerine kullanılır — pasif gelir hesabında daha doğru. NULL = hiçbir tx
    /// yield set'lememiş, asset-level fallback.
    pub weighted_yield_pct: Option<f64>,
}

/// Bir asset'in işlemlerinden pozisyon özeti çıkarır.
///
/// Algoritma (Average Cost Method):
/// - Buy: total_cost += qty*price + fee; balance += qty
/// - Sell: realized = (price - avg_cost)*qty - fee
///   total_cost -= avg_cost*qty (proporsiyonel düşür)
///   balance -= qty
/// - Passive income: balance += qty (bedava), cost değişmez
///
/// is_deleted=1 olanlar atılır.
pub fn position_from_transactions(txns: &[Transaction]) -> PositionSummary {
    // Tarih ASC sırada işle (girişte sıralı değilse de çalışsın diye copy & sort)
    let mut sorted: Vec<&Transaction> =
        txns.iter().filter(|t| t.is_deleted == 0).collect();
    sorted.sort_by_key(|t| (t.date, t.id));

    let mut s = PositionSummary::default();
    // USD-locked paralel hesap: her buy'da fx_to_usd ile çarpıp tut.
    // Herhangi bir buy lock'sızsa flag false → final None.
    let mut cost_usd_locked = 0.0;
    let mut all_buys_have_lock = true;
    let mut had_any_buy = false;
    // Yield-weighted ortalama — platform-bazlı lot tüketimi. Her buy bir lot
    // ekler; satış **önce o platformdaki** lot'tan tüketir (alımdaki faiz oranı
    // zaten platforma bağlı — kullanıcı hem alırken hem satarken platform seçer),
    // yetmezse kalan lot'lardan FIFO. Ortalama satıştan sonra kalan lot'lardan
    // hesaplanır. (oransal düşüm yapan eski yöntem oranı hiç değiştirmiyordu.)
    struct YieldLot {
        qty: f64,
        cost_per_unit: f64,
        yield_pct: Option<f64>,
        platform: String,
    }
    let mut yield_lots: Vec<YieldLot> = Vec::new();

    for t in sorted {
        match t.tx_type.as_str() {
            "buy" => {
                let cost = t.quantity * t.price + t.fee;
                s.total_cost += cost;
                s.balance += t.quantity;
                s.total_bought += t.quantity;
                had_any_buy = true;
                match t.fx_to_usd {
                    Some(fx) if fx > 0.0 => {
                        cost_usd_locked += cost * fx;
                    }
                    _ => {
                        all_buys_have_lock = false;
                    }
                }
                // Yield lot — maliyet/birim ağırlıklı, platform etiketli
                let cpu = if t.quantity > 0.0 {
                    cost / t.quantity
                } else {
                    0.0
                };
                yield_lots.push(YieldLot {
                    qty: t.quantity,
                    cost_per_unit: cpu,
                    yield_pct: t.expected_yield_pct,
                    platform: t.platform.as_deref().unwrap_or("").trim().to_string(),
                });
            }
            "sell" => {
                let avg = if s.balance > 0.0 {
                    s.total_cost / s.balance
                } else {
                    0.0
                };
                let realized = (t.price - avg) * t.quantity - t.fee;
                s.realized_pl += realized;
                // USD-locked oransal düşüm — sell tx'ten önceki balance üzerinden
                if s.balance > 0.0 && all_buys_have_lock {
                    let frac = t.quantity / s.balance;
                    cost_usd_locked -= cost_usd_locked * frac;
                }
                // Yield lot'larından tüket — YALNIZCA satışın yapıldığı
                // platformdaki lot'tan, FIFO (alımdaki faiz oranı zaten o
                // platforma bağlı). Başka platforma TAŞMAZ: bir platformdaki
                // fazla-satış (oversell) diğer platformun yield hesabını
                // bozmamalı — kullanıcı zaten her platform için ayrı satış
                // bacağı/işlemi giriyor. Eşleşmeyen kalan miktar yok sayılır.
                let sell_plat =
                    t.platform.as_deref().unwrap_or("").trim().to_string();
                let mut to_consume = t.quantity;
                let mut i = 0;
                while to_consume > 1e-12 && i < yield_lots.len() {
                    if yield_lots[i].platform != sell_plat {
                        i += 1;
                        continue;
                    }
                    let lot_qty = yield_lots[i].qty;
                    if lot_qty <= to_consume + 1e-12 {
                        to_consume -= lot_qty;
                        yield_lots.remove(i); // sonraki eleman i'ye kayar
                    } else {
                        yield_lots[i].qty -= to_consume;
                        to_consume = 0.0;
                    }
                }
                s.total_cost -= avg * t.quantity;
                s.balance -= t.quantity;
                s.total_sold += t.quantity;
                if s.balance.abs() < 1e-12 {
                    s.balance = 0.0;
                    s.total_cost = 0.0;
                    cost_usd_locked = 0.0;
                    yield_lots.clear();
                }
            }
            "passive_income" => {
                s.balance += t.quantity;
                s.passive_income_qty += t.quantity;
            }
            _ => {}
        }
    }

    s.avg_cost = if s.balance.abs() > 1e-12 {
        s.total_cost / s.balance
    } else {
        0.0
    };
    s.total_cost_usd_locked = if had_any_buy && all_buys_have_lock {
        Some(cost_usd_locked)
    } else {
        None
    };
    // Kalan lot'lardan maliyet ağırlıklı yield ortalaması
    s.weighted_yield_pct = {
        let mut wsum = 0.0;
        let mut wtot = 0.0;
        for lot in &yield_lots {
            if let Some(yp) = lot.yield_pct {
                let w = lot.qty * lot.cost_per_unit;
                wsum += w * yp;
                wtot += w;
            }
        }
        if wtot > 1e-9 {
            Some(wsum / wtot)
        } else {
            None
        }
    };
    s
}

/* ----------------------------------------------------------------
 * validate_sale
 * ---------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize)]
pub struct SaleValidation {
    pub asset_id: i64,
    pub current_balance: f64,
    pub attempted_quantity: f64,
    pub is_sufficient: bool,
    /// Yetersizse mevcut bakiye (UI: "Hepsini sattım"); yeterliyse istenen miktar.
    pub suggested_max: f64,
    /// Yetersizse açığa düşeceği miktar (- işaretli pozisyon).
    pub shortage: f64,
}

/// `platform` verilirse o platformun net bakiyesine göre kontrol edilir
/// (örn. OKX'te 800 varken 1000 satışı yetersiz sayılır). Boş/None ise
/// asset'in toplam bakiyesi kullanılır.
#[tauri::command]
pub async fn validate_sale(
    db: State<'_, Db>,
    asset_id: i64,
    quantity: f64,
    platform: Option<String>,
) -> AppResult<SaleValidation> {
    let txns = load_transactions(&db.pool, asset_id).await?;
    let current_balance = match platform.as_deref().map(str::trim) {
        Some(p) if !p.is_empty() => {
            // O platformdaki net qty — buy/passive_income (+), sell (-)
            let mut bal = 0.0;
            for t in &txns {
                if t.is_deleted != 0 {
                    continue;
                }
                if t.platform.as_deref().unwrap_or("").trim() != p {
                    continue;
                }
                bal += match t.tx_type.as_str() {
                    "buy" | "passive_income" => t.quantity,
                    "sell" => -t.quantity,
                    _ => 0.0,
                };
            }
            bal
        }
        _ => position_from_transactions(&txns).balance,
    };
    let is_sufficient = quantity <= current_balance + 1e-9;
    let shortage = (quantity - current_balance).max(0.0);
    Ok(SaleValidation {
        asset_id,
        current_balance,
        attempted_quantity: quantity,
        is_sufficient,
        suggested_max: if is_sufficient {
            quantity
        } else {
            current_balance.max(0.0)
        },
        shortage,
    })
}

/* ----------------------------------------------------------------
 * calculate_portfolio
 * ---------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize)]
pub struct AssetStats {
    pub asset_id: i64,
    pub symbol: String,
    pub name: String,
    pub asset_type: String,
    pub asset_currency: String,
    pub icon_url: Option<String>,
    pub expected_yield_pct: Option<f64>,
    pub platform: Option<String>,
    /// Bu asset için işlemlerden derive edilen distinct platform listesi.
    /// Boşsa asset.platform tek-elemanlı düşer; çoklu ise "Çeşitli" göstergesi
    /// için sayıya bakılır.
    pub platforms: Vec<String>,
    pub balance: f64,
    pub avg_cost: f64,
    pub current_price: Option<f64>,
    pub price_currency: Option<String>,
    pub price_fetched_at: Option<i64>,
    pub price_change_24h_pct: Option<f64>,
    /// Display currency cinsinden mevcut piyasa değeri.
    pub market_value_display: Option<f64>,
    /// Display currency cinsinden total cost (geçmiş alışlar).
    pub total_cost_display: f64,
    /// Display currency cinsinden unrealized P/L.
    pub unrealized_pl_display: Option<f64>,
    /// Asset para biriminde realize edilmiş P/L.
    pub realized_pl_native: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortfolioStats {
    pub portfolio_id: i64,
    pub display_currency: String,
    pub total_value: f64,
    pub total_cost: f64,
    pub total_unrealized_pl: f64,
    /// Display currency cinsinden son 24 saatteki net değişim (mutlak değer).
    pub total_change_24h: Option<f64>,
    /// Yüzde olarak portföy bütünündeki 24h değişim. Asset'lerin market_value
    /// ağırlıklı ortalaması.
    pub total_change_24h_pct: Option<f64>,
    pub assets: Vec<AssetStats>,
    /// Cache'den fiyatı eksik kalan asset sayısı — UI uyarısı için
    pub assets_missing_price: i64,
}

#[tauri::command]
pub async fn calculate_portfolio(
    db: State<'_, Db>,
    portfolio_id: i64,
    display_currency: String,
) -> AppResult<PortfolioStats> {
    calculate_portfolio_inner(&db.pool, portfolio_id, &display_currency).await
}

/// Pure-pool versiyon — Tauri State olmadan çağrılabilir (örn. budget projection).
pub async fn calculate_portfolio_inner(
    pool: &sqlx::SqlitePool,
    portfolio_id: i64,
    display_currency: &str,
) -> AppResult<PortfolioStats> {
    let display_currency = display_currency.to_uppercase();

    // Schema safety: eski binary'den geçen bir DB'de yeni kolonlar eksikse
    crate::commands::asset::ensure_asset_columns(pool).await?;

    // Asset listesi
    let assets: Vec<crate::db::models::Asset> = sqlx::query_as(
        "SELECT id, portfolio_id, symbol, name, type, currency, external_id, created_at,
                expected_yield_pct, icon_url, platform
         FROM assets WHERE portfolio_id = ?",
    )
    .bind(portfolio_id)
    .fetch_all(pool)
    .await?;

    // FX rate'leri cache'siz çekme — display currency conversion gerekirse.
    // Bu pahalı olduğu için ihtiyaç olduğunda bir kez çek.
    //
    // Not: fx/commodity asset'lerinin cached fiyatı TCMB'den TRY cinsinden
    // geldiği için, asset.currency display ile eşleşse bile price_currency
    // (TRY) → display dönüşümü gerekebilir. Bu yüzden tipe de bak.
    let needs_fx = assets.iter().any(|a| !a.currency.eq_ignore_ascii_case(&display_currency))
        || assets
            .iter()
            .any(|a| a.asset_type == "fx" || a.asset_type == "commodity")
        || matches!(display_currency.as_str(), "BTC" | "ETH");
    let fx = if needs_fx {
        let mut rates = crate::services::fx::fetch_rates().await?;
        enrich_with_crypto(&mut rates, &display_currency, pool).await;
        for a in &assets {
            enrich_with_crypto(&mut rates, &a.currency, pool).await;
        }
        Some(rates)
    } else {
        None
    };

    let mut total_value = 0.0;
    let mut total_cost_sum = 0.0;
    let mut total_unrealized = 0.0;
    let mut assets_missing_price: i64 = 0;
    // 24h delta hesabı için: sum(mv) ve sum(mv / (1 + pct/100)) — eski değer
    let mut sum_mv_with_pct = 0.0;
    let mut sum_prev_value = 0.0;
    let mut out = Vec::with_capacity(assets.len());

    for a in &assets {
        let txns = load_transactions(pool, a.id).await?;
        let pos = position_from_transactions(&txns);

        // Platformlar tamamen transaction'lardan türetilir:
        //   buy / passive_income  → +qty
        //   sell                  → -qty
        // Her tx kendi platformunu taşır. Bir platformda net qty > 0 ise
        // listede yer alır. Sıfırlanan platform otomatik düşer. Asset-level
        // `asset.platform` artık platform listesi için referans değil
        // (varsayılan değer olarak yeni tx ekleme modal'ında kullanılabilir).
        let mut per_platform: std::collections::HashMap<String, f64> =
            std::collections::HashMap::new();
        for t in &txns {
            let plat = match t.platform.as_deref().map(|s| s.trim()) {
                Some(s) if !s.is_empty() => s.to_string(),
                _ => continue,
            };
            let delta = match t.tx_type.as_str() {
                "buy" | "passive_income" => t.quantity,
                "sell" => -t.quantity,
                _ => 0.0,
            };
            *per_platform.entry(plat).or_insert(0.0) += delta;
        }
        let mut platforms: Vec<String> = per_platform
            .into_iter()
            .filter(|(_, qty)| *qty > 1e-9)
            .map(|(p, _)| p)
            .collect();
        platforms.sort();
        let cached = cache::get(pool, a.id).await?;

        let (current_price, price_currency, price_fetched_at, price_change_24h_pct) = match &cached
        {
            Some(c) => (
                Some(c.price),
                Some(c.currency.clone()),
                Some(c.fetched_at),
                c.change_24h_pct,
            ),
            None => (None, None, None, None),
        };

        // Conversion: avg_cost asset cinsinden, current_price cache cinsinden, display farklı olabilir.
        // USD-locked cost varsa (tüm buy tx'leri tarihsel kur kilitli) USD baz alınır,
        // aksi halde asset.currency'den display'e current FX ile dönüşüm.
        let cost_in_display = match pos.total_cost_usd_locked {
            Some(usd) => convert(usd, "USD", &display_currency, fx.as_ref()),
            None => convert(
                pos.total_cost,
                &a.currency,
                &display_currency,
                fx.as_ref(),
            ),
        };
        let (market_value_display, unrealized_pl_display) = match (&current_price, &price_currency)
        {
            (Some(p), Some(pc)) => {
                let mv_native = pos.balance * p;
                let mv = convert(mv_native, pc, &display_currency, fx.as_ref());
                (Some(mv), Some(mv - cost_in_display))
            }
            _ => {
                assets_missing_price += 1;
                (None, None)
            }
        };

        if let Some(mv) = market_value_display {
            total_value += mv;
            // 24h: ağırlıklı geri-hesap. mv (now) ve pct biliniyorsa,
            // 24h önceki değer = mv / (1 + pct/100).
            if let Some(pct) = price_change_24h_pct {
                let prev = mv / (1.0 + pct / 100.0);
                sum_mv_with_pct += mv;
                sum_prev_value += prev;
            }
        }
        total_cost_sum += cost_in_display;
        if let Some(u) = unrealized_pl_display {
            total_unrealized += u;
        }

        out.push(AssetStats {
            asset_id: a.id,
            symbol: a.symbol.clone(),
            name: a.name.clone(),
            asset_type: a.asset_type.clone(),
            asset_currency: a.currency.clone(),
            icon_url: a.icon_url.clone(),
            expected_yield_pct: pos.weighted_yield_pct.or(a.expected_yield_pct),
            platform: a.platform.clone(),
            platforms: platforms.clone(),
            balance: pos.balance,
            avg_cost: pos.avg_cost,
            current_price,
            price_currency,
            price_fetched_at,
            price_change_24h_pct,
            market_value_display,
            total_cost_display: cost_in_display,
            unrealized_pl_display,
            realized_pl_native: pos.realized_pl,
        });
    }

    let (total_change_24h, total_change_24h_pct) = if sum_prev_value > 0.0 {
        let delta = sum_mv_with_pct - sum_prev_value;
        let pct = (delta / sum_prev_value) * 100.0;
        (Some(delta), Some(pct))
    } else {
        (None, None)
    };

    Ok(PortfolioStats {
        portfolio_id,
        display_currency,
        total_value,
        total_cost: total_cost_sum,
        total_unrealized_pl: total_unrealized,
        total_change_24h,
        total_change_24h_pct,
        assets: out,
        assets_missing_price,
    })
}

/* ----------------------------------------------------------------
 * calculate_passive_income
 * ---------------------------------------------------------------- */

#[derive(Debug, Clone, Default, Serialize)]
pub struct PassiveIncomeBreakdown {
    pub staking: f64,
    pub dividend: f64,
    pub interest: f64,
    pub total: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PassiveIncomeStats {
    pub portfolio_id: Option<i64>,
    pub display_currency: String,
    pub period: String,
    pub from_ts: Option<i64>,
    pub breakdown: PassiveIncomeBreakdown,
    /// Aylık trend: ay etiketi (YYYY-MM) → display currency toplamı
    pub monthly: Vec<(String, f64)>,
    pub records_count: i64,
}

#[tauri::command]
pub async fn calculate_passive_income(
    db: State<'_, Db>,
    portfolio_id: Option<i64>,
    display_currency: String,
    period: String,
) -> AppResult<PassiveIncomeStats> {
    let display_currency = display_currency.to_uppercase();
    let from_ts = period_to_from(&period);

    // Passive income işlemlerini portföydeki tüm asset'lerden çek + asset metadata.
    // portfolio_id None ise tüm portföylerden ("Hepsi" görünümü).
    #[derive(sqlx::FromRow)]
    #[allow(dead_code)]
    struct Row {
        asset_id: i64,
        date: i64,
        source: Option<String>,
        quantity: f64,
        price: f64,
        currency: String,
    }

    let rows: Vec<Row> = match (portfolio_id, from_ts) {
        (Some(pid), Some(ts)) => {
            sqlx::query_as(
                "SELECT t.asset_id, t.date, t.source, t.quantity, t.price, a.currency
                 FROM transactions t
                 JOIN assets a ON a.id = t.asset_id
                 WHERE a.portfolio_id = ? AND t.type = 'passive_income'
                   AND t.is_deleted = 0 AND t.date >= ?",
            )
            .bind(pid)
            .bind(ts)
            .fetch_all(&db.pool)
            .await?
        }
        (Some(pid), None) => {
            sqlx::query_as(
                "SELECT t.asset_id, t.date, t.source, t.quantity, t.price, a.currency
                 FROM transactions t
                 JOIN assets a ON a.id = t.asset_id
                 WHERE a.portfolio_id = ? AND t.type = 'passive_income' AND t.is_deleted = 0",
            )
            .bind(pid)
            .fetch_all(&db.pool)
            .await?
        }
        (None, Some(ts)) => {
            sqlx::query_as(
                "SELECT t.asset_id, t.date, t.source, t.quantity, t.price, a.currency
                 FROM transactions t
                 JOIN assets a ON a.id = t.asset_id
                 WHERE t.type = 'passive_income' AND t.is_deleted = 0 AND t.date >= ?",
            )
            .bind(ts)
            .fetch_all(&db.pool)
            .await?
        }
        (None, None) => {
            sqlx::query_as(
                "SELECT t.asset_id, t.date, t.source, t.quantity, t.price, a.currency
                 FROM transactions t
                 JOIN assets a ON a.id = t.asset_id
                 WHERE t.type = 'passive_income' AND t.is_deleted = 0",
            )
            .fetch_all(&db.pool)
            .await?
        }
    };

    // FX yalnızca conversion gerekiyorsa
    let mut fx: Option<tcmb::FxRates> = None;

    // current price cache (USD karşılığı için spot kullanılabilir; burada
    // transaction.price'i asset para biriminde değer olarak kabul ediyoruz —
    // örn. dividend'da price, hisse cinsinden değil; alan PLAN'da "birim fiyat".
    // Pratik: passive_income için "value = quantity * price"
    let mut breakdown = PassiveIncomeBreakdown::default();
    let mut monthly: std::collections::BTreeMap<String, f64> = Default::default();
    let mut count: i64 = 0;

    for r in rows {
        let value_native = r.quantity * r.price;
        let value_display = if r.currency.eq_ignore_ascii_case(&display_currency) {
            value_native
        } else {
            if fx.is_none() {
                let mut rates = crate::services::fx::fetch_rates().await?;
                enrich_with_crypto(&mut rates, &display_currency, &db.pool).await;
                enrich_with_crypto(&mut rates, &r.currency, &db.pool).await;
                fx = Some(rates);
            } else if let Some(f) = fx.as_mut() {
                enrich_with_crypto(f, &r.currency, &db.pool).await;
            }
            convert(value_native, &r.currency, &display_currency, fx.as_ref())
        };

        match r.source.as_deref() {
            Some("staking") => breakdown.staking += value_display,
            Some("dividend") => breakdown.dividend += value_display,
            Some("interest") => breakdown.interest += value_display,
            _ => {}
        }
        breakdown.total += value_display;
        count += 1;

        let dt = chrono::DateTime::<chrono::Utc>::from_timestamp(r.date, 0)
            .unwrap_or_else(chrono::Utc::now);
        let label = dt.format("%Y-%m").to_string();
        *monthly.entry(label).or_insert(0.0) += value_display;
    }

    Ok(PassiveIncomeStats {
        portfolio_id,
        display_currency,
        period,
        from_ts,
        breakdown,
        monthly: monthly.into_iter().collect(),
        records_count: count,
    })
}

fn period_to_from(period: &str) -> Option<i64> {
    let now = chrono::Utc::now();
    match period.to_lowercase().as_str() {
        "30d" => Some((now - chrono::Duration::days(30)).timestamp()),
        "90d" => Some((now - chrono::Duration::days(90)).timestamp()),
        "1y" | "365d" => Some((now - chrono::Duration::days(365)).timestamp()),
        "ytd" => {
            let y = now.format("%Y").to_string().parse::<i32>().ok()?;
            chrono::NaiveDate::from_ymd_opt(y, 1, 1)?
                .and_hms_opt(0, 0, 0)
                .map(|d| d.and_utc().timestamp())
        }
        _ => None, // "all"
    }
}

/* ----------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------- */

async fn load_transactions(pool: &SqlitePool, asset_id: i64) -> AppResult<Vec<Transaction>> {
    let rows: Vec<Transaction> = sqlx::query_as(
        "SELECT id, asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform, expected_yield_pct
         FROM transactions WHERE asset_id = ? AND is_deleted = 0",
    )
    .bind(asset_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// BTC/ETH USD fiyatı için process-wide in-memory cache. 60 sn TTL —
/// currency switch'lerinde Binance'a tekrar tekrar gitmesin. WebSocket
/// canlı tick'i zaten price_cache'i 1-2 sn'de bir günceller; cache miss
/// fall through Binance + CoinGecko + price_cache zinciri.
struct CryptoPriceCache {
    btc_usd: Option<(f64, i64)>, // (price, unix_secs)
    eth_usd: Option<(f64, i64)>,
}

static CRYPTO_PRICE_CACHE: std::sync::OnceLock<tokio::sync::Mutex<CryptoPriceCache>> =
    std::sync::OnceLock::new();

const CRYPTO_CACHE_TTL_SECS: i64 = 60;

fn crypto_cache() -> &'static tokio::sync::Mutex<CryptoPriceCache> {
    CRYPTO_PRICE_CACHE.get_or_init(|| {
        tokio::sync::Mutex::new(CryptoPriceCache {
            btc_usd: None,
            eth_usd: None,
        })
    })
}

/// BTC veya ETH için USD fiyatı (TRY köprüsüne enjekte etmek için):
///   1. In-memory cache (60s TTL) — currency switch instant
///   2. price_cache (eğer kullanıcının BTC/ETH asset'i varsa, WebSocket
///      tarafından canlı güncellenir; ortalama 1-2 sn fresh)
///   3. Binance REST canlı
///   4. CoinGecko fallback
///   5. price_cache (stale fallback)
pub async fn enrich_with_crypto(
    rates: &mut tcmb::FxRates,
    code: &str,
    pool: &sqlx::SqlitePool,
) {
    let key = code.to_uppercase();
    if rates.rates.contains_key(&key) {
        return;
    }
    let cg_id = match key.as_str() {
        "BTC" => "bitcoin",
        "ETH" => "ethereum",
        _ => return,
    };
    let usd_try = match rates.rates.get("USD").copied() {
        Some(v) if v > 0.0 => v,
        _ => return,
    };

    let now_secs = chrono::Utc::now().timestamp();

    // 1) In-memory cache (process-wide, 60s TTL)
    {
        let guard = crypto_cache().lock().await;
        let slot = match key.as_str() {
            "BTC" => guard.btc_usd,
            "ETH" => guard.eth_usd,
            _ => None,
        };
        if let Some((price, ts)) = slot {
            if now_secs - ts < CRYPTO_CACHE_TTL_SECS && price > 0.0 {
                rates.rates.insert(key, price * usd_try);
                return;
            }
        }
    }

    // 2) price_cache fresh? (WebSocket sayesinde sürekli güncellenir, hızlı)
    let cached: Option<(f64, i64)> = sqlx::query_as(
        "SELECT pc.price, pc.fetched_at FROM price_cache pc
         JOIN assets a ON a.id = pc.asset_id
         WHERE UPPER(a.symbol) = ? AND UPPER(pc.currency) = 'USD'
         ORDER BY pc.fetched_at DESC LIMIT 1",
    )
    .bind(&key)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let mut usd_price: Option<f64> = None;
    if let Some((v, ts)) = cached {
        // 5 dk içindeyse fresh kabul
        if v > 0.0 && (now_secs - ts) < 5 * 60 {
            usd_price = Some(v);
        }
    }

    // 3) Binance canlı (cache stale veya yoksa)
    if usd_price.is_none() {
        if let Ok(q) = binance_rest::fetch_quote(&key).await {
            if q.usd_price > 0.0 {
                usd_price = Some(q.usd_price);
            }
        }
    }

    // 4) CoinGecko fallback
    if usd_price.is_none() {
        if let Ok(p) = coingecko::fetch_price(cg_id).await {
            if p.usd > 0.0 {
                usd_price = Some(p.usd);
            }
        }
    }

    // 5) Stale price_cache fallback (5+ dk eski olsa bile)
    if usd_price.is_none() {
        if let Some((v, _)) = cached {
            if v > 0.0 {
                log::info!("[birik] enrich_with_crypto stale cache fallback for {key}: {v}");
                usd_price = Some(v);
            }
        }
    }

    if let Some(usd) = usd_price {
        // In-memory cache yaz
        {
            let mut guard = crypto_cache().lock().await;
            match key.as_str() {
                "BTC" => guard.btc_usd = Some((usd, now_secs)),
                "ETH" => guard.eth_usd = Some((usd, now_secs)),
                _ => {}
            }
        }
        rates.rates.insert(key, usd * usd_try);
    } else {
        log::warn!("[birik] enrich_with_crypto FAILED for {key} — tüm fallback'ler eksik");
    }
}

/// PLAN: TCMB rates 1 birim X için TRY karşılığı verir.
/// Burada from→to dönüşümü TRY üzerinden köprüleniyor.
pub fn convert(amount: f64, from: &str, to: &str, fx: Option<&tcmb::FxRates>) -> f64 {
    if from.eq_ignore_ascii_case(to) {
        return amount;
    }
    let Some(fx) = fx else {
        return amount; // FX yoksa best-effort: aynen geçir (UI not göstersin)
    };
    let to_try = |c: &str| -> Option<f64> {
        if c.eq_ignore_ascii_case("TRY") {
            Some(1.0)
        } else {
            fx.rates.get(&c.to_uppercase()).copied()
        }
    };
    let f = to_try(from).unwrap_or(0.0);
    let t = to_try(to).unwrap_or(0.0);
    if f == 0.0 || t == 0.0 {
        return amount;
    }
    amount * f / t
}

/* ----------------------------------------------------------------
 * Tests
 * ---------------------------------------------------------------- */

#[cfg(test)]
mod tests {
    use super::*;

    fn tx(id: i64, date: i64, kind: &str, qty: f64, price: f64, fee: f64) -> Transaction {
        Transaction {
            id,
            asset_id: 1,
            date,
            tx_type: kind.into(),
            source: None,
            quantity: qty,
            price,
            fee,
            note: None,
            is_deleted: 0,
            created_at: 0,
            fx_to_usd: None,
            platform: None,
            expected_yield_pct: None,
        }
    }

    fn tx_passive(id: i64, date: i64, qty: f64, source: &str) -> Transaction {
        let mut t = tx(id, date, "passive_income", qty, 0.0, 0.0);
        t.source = Some(source.into());
        t
    }

    #[test]
    fn empty_position() {
        let p = position_from_transactions(&[]);
        assert_eq!(p, PositionSummary::default());
    }

    #[test]
    fn single_buy_sets_avg_cost() {
        let txs = vec![tx(1, 100, "buy", 0.5, 60_000.0, 0.0)];
        let p = position_from_transactions(&txs);
        assert!((p.balance - 0.5).abs() < 1e-9);
        assert!((p.avg_cost - 60_000.0).abs() < 1e-9);
        assert!((p.total_cost - 30_000.0).abs() < 1e-9);
        assert_eq!(p.realized_pl, 0.0);
    }

    #[test]
    fn buy_with_fee_increases_cost() {
        let txs = vec![tx(1, 100, "buy", 1.0, 100.0, 5.0)];
        let p = position_from_transactions(&txs);
        assert!((p.total_cost - 105.0).abs() < 1e-9);
        assert!((p.avg_cost - 105.0).abs() < 1e-9);
    }

    #[test]
    fn average_cost_across_buys() {
        let txs = vec![
            tx(1, 100, "buy", 1.0, 100.0, 0.0),
            tx(2, 200, "buy", 1.0, 200.0, 0.0),
        ];
        let p = position_from_transactions(&txs);
        assert!((p.balance - 2.0).abs() < 1e-9);
        assert!((p.avg_cost - 150.0).abs() < 1e-9);
        assert!((p.total_cost - 300.0).abs() < 1e-9);
    }

    #[test]
    fn partial_sell_realizes_pl() {
        // 2 BTC @ 100, sat 1 BTC @ 200 → realized 100, kalan 1 BTC @ 100
        let txs = vec![
            tx(1, 100, "buy", 2.0, 100.0, 0.0),
            tx(2, 200, "sell", 1.0, 200.0, 0.0),
        ];
        let p = position_from_transactions(&txs);
        assert!((p.balance - 1.0).abs() < 1e-9);
        assert!((p.avg_cost - 100.0).abs() < 1e-9);
        assert!((p.realized_pl - 100.0).abs() < 1e-9);
    }

    #[test]
    fn weighted_yield_fifo_consumes_oldest_lot() {
        // 1000 @ %1.5, 300 @ %8, 200 @ %15 — en eski 1000'lik lot satılınca
        // ortalama yield kalan lot'lardan hesaplanmalı (regression: eski
        // oransal-düşüm yöntemi oranı hiç değiştirmiyordu).
        let mut b1 = tx(1, 100, "buy", 1000.0, 1.0, 0.0);
        b1.expected_yield_pct = Some(1.5);
        let mut b2 = tx(2, 200, "buy", 300.0, 1.0, 0.0);
        b2.expected_yield_pct = Some(8.0);
        let mut b3 = tx(3, 300, "buy", 200.0, 1.0, 0.0);
        b3.expected_yield_pct = Some(15.0);
        let sell = tx(4, 400, "sell", 1000.0, 1.0, 0.0);

        let p = position_from_transactions(&[b1, b2, b3, sell]);
        // Kalan: 300 @ %8 + 200 @ %15 → (300*8 + 200*15) / 500 = 10.8
        let wy = p.weighted_yield_pct.expect("yield bekleniyor");
        assert!((wy - 10.8).abs() < 1e-9, "beklenen 10.8, gelen {wy}");
    }

    #[test]
    fn weighted_yield_fifo_partial_into_next_lot() {
        // 100 @ %2, 100 @ %10 — 150 sat → ilk lot biter, ikinciden 50 kalır
        let mut b1 = tx(1, 100, "buy", 100.0, 1.0, 0.0);
        b1.expected_yield_pct = Some(2.0);
        let mut b2 = tx(2, 200, "buy", 100.0, 1.0, 0.0);
        b2.expected_yield_pct = Some(10.0);
        let sell = tx(3, 300, "sell", 150.0, 1.0, 0.0);

        let p = position_from_transactions(&[b1, b2, sell]);
        // Kalan: 50 @ %10 → ortalama 10
        let wy = p.weighted_yield_pct.expect("yield bekleniyor");
        assert!((wy - 10.0).abs() < 1e-9, "beklenen 10.0, gelen {wy}");
    }

    #[test]
    fn weighted_yield_consumes_from_sold_platform() {
        // Platform-bazlı: önce B'den 300 @ %8, sonra OKX'ten 1000 @ %1.5,
        // sonra C'den 200 @ %15 al. OKX'ten 1000 sat → OKX lot'u çıkmalı.
        // (Global FIFO olsaydı en eski B lot'unu yerdi → yanlış.)
        let mut b1 = tx(1, 100, "buy", 300.0, 1.0, 0.0);
        b1.expected_yield_pct = Some(8.0);
        b1.platform = Some("B".into());
        let mut b2 = tx(2, 200, "buy", 1000.0, 1.0, 0.0);
        b2.expected_yield_pct = Some(1.5);
        b2.platform = Some("OKX".into());
        let mut b3 = tx(3, 300, "buy", 200.0, 1.0, 0.0);
        b3.expected_yield_pct = Some(15.0);
        b3.platform = Some("C".into());
        let mut sell = tx(4, 400, "sell", 1000.0, 1.0, 0.0);
        sell.platform = Some("OKX".into());

        let p = position_from_transactions(&[b1, b2, b3, sell]);
        // Kalan: 300 @ %8 (B) + 200 @ %15 (C) → (300*8 + 200*15) / 500 = 10.8
        let wy = p.weighted_yield_pct.expect("yield bekleniyor");
        assert!((wy - 10.8).abs() < 1e-9, "beklenen 10.8, gelen {wy}");
    }

    #[test]
    fn weighted_yield_oversell_does_not_cross_platform() {
        // OKX'te 100 @ %2. B'de 100 @ %5 + 100 @ %20. OKX'ten 150 sat
        // (fazla satış) → sadece OKX lot'u biter, fazlalık (50) hiçbir yere
        // taşmaz. B lot'ları dokunulmaz → (100*5 + 100*20) / 200 = 12.5.
        let mut b1 = tx(1, 100, "buy", 100.0, 1.0, 0.0);
        b1.expected_yield_pct = Some(2.0);
        b1.platform = Some("OKX".into());
        let mut b2 = tx(2, 200, "buy", 100.0, 1.0, 0.0);
        b2.expected_yield_pct = Some(5.0);
        b2.platform = Some("B".into());
        let mut b3 = tx(3, 300, "buy", 100.0, 1.0, 0.0);
        b3.expected_yield_pct = Some(20.0);
        b3.platform = Some("B".into());
        let mut sell = tx(4, 400, "sell", 150.0, 1.0, 0.0);
        sell.platform = Some("OKX".into());

        let p = position_from_transactions(&[b1, b2, b3, sell]);
        let wy = p.weighted_yield_pct.expect("yield bekleniyor");
        assert!((wy - 12.5).abs() < 1e-9, "beklenen 12.5, gelen {wy}");
    }

    #[test]
    fn full_sell_zeros_position() {
        let txs = vec![
            tx(1, 100, "buy", 2.0, 100.0, 0.0),
            tx(2, 200, "sell", 2.0, 150.0, 0.0),
        ];
        let p = position_from_transactions(&txs);
        assert_eq!(p.balance, 0.0);
        assert_eq!(p.total_cost, 0.0);
        assert_eq!(p.avg_cost, 0.0);
        assert!((p.realized_pl - 100.0).abs() < 1e-9);
    }

    #[test]
    fn passive_income_increases_balance_not_cost() {
        let txs = vec![
            tx(1, 100, "buy", 1.0, 100.0, 0.0),
            tx_passive(2, 200, 0.1, "staking"),
        ];
        let p = position_from_transactions(&txs);
        assert!((p.balance - 1.1).abs() < 1e-9);
        assert!((p.total_cost - 100.0).abs() < 1e-9);
        assert!((p.passive_income_qty - 0.1).abs() < 1e-9);
        // avg_cost düşer çünkü daha fazla coin var aynı maliyetle
        assert!((p.avg_cost - (100.0 / 1.1)).abs() < 1e-9);
    }

    #[test]
    fn out_of_order_dates_are_normalized() {
        let txs = vec![
            tx(2, 200, "sell", 1.0, 200.0, 0.0),
            tx(1, 100, "buy", 2.0, 100.0, 0.0),
        ];
        let p = position_from_transactions(&txs);
        assert!((p.balance - 1.0).abs() < 1e-9);
        assert!((p.realized_pl - 100.0).abs() < 1e-9);
    }

    #[test]
    fn deleted_transactions_are_ignored() {
        let mut txs = vec![
            tx(1, 100, "buy", 1.0, 100.0, 0.0),
            tx(2, 200, "buy", 1.0, 200.0, 0.0),
        ];
        txs[1].is_deleted = 1;
        let p = position_from_transactions(&txs);
        assert!((p.balance - 1.0).abs() < 1e-9);
        assert!((p.avg_cost - 100.0).abs() < 1e-9);
    }

    #[test]
    fn sell_more_than_balance_goes_negative() {
        // Plan §11: kullanıcı izin verirse short pozisyon
        let txs = vec![
            tx(1, 100, "buy", 1.0, 100.0, 0.0),
            tx(2, 200, "sell", 3.0, 200.0, 0.0),
        ];
        let p = position_from_transactions(&txs);
        assert!(p.balance < 0.0);
    }

    /* ----- validate_sale logic ----- */

    #[test]
    fn validate_sale_sufficient() {
        let txs = vec![tx(1, 100, "buy", 3.0, 100.0, 0.0)];
        let pos = position_from_transactions(&txs);
        // 2 of 3 — sufficient
        let attempted = 2.0;
        let is_sufficient = attempted <= pos.balance + 1e-9;
        assert!(is_sufficient);
    }

    #[test]
    fn validate_sale_insufficient() {
        let txs = vec![tx(1, 100, "buy", 3.0, 100.0, 0.0)];
        let pos = position_from_transactions(&txs);
        // 5 of 3 — insufficient, suggested_max=3, shortage=2 (PLAN §6 senaryosu)
        let attempted = 5.0;
        let is_sufficient = attempted <= pos.balance + 1e-9;
        let shortage = (attempted - pos.balance).max(0.0);
        let suggested_max = if is_sufficient {
            attempted
        } else {
            pos.balance
        };
        assert!(!is_sufficient);
        assert!((shortage - 2.0).abs() < 1e-9);
        assert!((suggested_max - 3.0).abs() < 1e-9);
    }

    /* ----- passive income breakdown ----- */

    #[test]
    fn passive_income_aggregates_by_source() {
        let mut staking = tx_passive(1, 100, 0.5, "staking");
        staking.price = 100.0;
        let mut div = tx_passive(2, 200, 1.0, "dividend");
        div.price = 50.0;
        let mut int_ = tx_passive(3, 300, 1.0, "interest");
        int_.price = 25.0;

        // Pure aggregator (calculate_passive_income gibi DB'siz simüle):
        let txs = [staking, div, int_];
        let mut b = PassiveIncomeBreakdown::default();
        for t in &txs {
            let v = t.quantity * t.price;
            match t.source.as_deref() {
                Some("staking") => b.staking += v,
                Some("dividend") => b.dividend += v,
                Some("interest") => b.interest += v,
                _ => {}
            }
            b.total += v;
        }
        assert!((b.staking - 50.0).abs() < 1e-9);
        assert!((b.dividend - 50.0).abs() < 1e-9);
        assert!((b.interest - 25.0).abs() < 1e-9);
        assert!((b.total - 125.0).abs() < 1e-9);
    }

    /* ----- conversion ----- */

    #[test]
    fn convert_same_currency_passthrough() {
        assert_eq!(convert(100.0, "USD", "USD", None), 100.0);
    }

    #[test]
    fn convert_via_try_bridge() {
        let mut rates = std::collections::HashMap::new();
        rates.insert("USD".to_string(), 32.0);
        rates.insert("EUR".to_string(), 36.0);
        let fx = tcmb::FxRates {
            fetched_at: 0,
            rates,
        };
        // 100 USD -> ? EUR: 100*32/36 = 88.88...
        let got = convert(100.0, "USD", "EUR", Some(&fx));
        assert!((got - (100.0 * 32.0 / 36.0)).abs() < 1e-9);
        // 100 USD -> TRY: 3200
        let try_ = convert(100.0, "USD", "TRY", Some(&fx));
        assert!((try_ - 3200.0).abs() < 1e-9);
    }
}
