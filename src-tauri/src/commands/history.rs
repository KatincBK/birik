//! Tarihsel fiyat grafik komutları.
//!
//! `fetch_asset_history`: asset.type'a göre Binance/Yahoo/Frankfurter seçer.
//!   Cache: price_history tablosu, TTL range'e göre değişir.
//!   Fallback: kripto Binance → CoinGecko, hisse Yahoo → Stooq (yok), döviz Frankfurter.
//!
//! `fetch_portfolio_history`: portfolio_snapshots'tan USD currency'sinde okur.

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

use crate::commands::now_secs;
use crate::error::{AppError, AppResult};
use crate::services::Db;

/// Frontend ile paylaşılan range string'leri: "1d" | "1w" | "1m" | "3m" | "1y" | "max"

#[derive(Debug, Clone, Serialize)]
pub struct AssetHistory {
    pub asset_id: i64,
    pub range: String,
    /// (timestamp_ms, price_in_asset_currency)
    pub points: Vec<(i64, f64)>,
    pub source: String,
    pub cache_hit: bool,
    pub fetched_at: i64,
}

fn ttl_seconds(range: &str) -> i64 {
    match range {
        "1d" => 5 * 60,
        "1w" | "1m" => 60 * 60,
        _ => 24 * 60 * 60,
    }
}

/// Range → Binance (interval, limit). Limit chart range'inden %20-50 fazla
/// veri çekiyor — edge'lerde data eksiği olmasın diye.
fn binance_params(range: &str) -> (&'static str, usize) {
    match range {
        "1d" => ("5m", 320),  // 26.7 saat
        "1w" => ("1h", 240),  // 10 gün
        "1m" => ("4h", 240),  // 40 gün
        "3m" => ("1d", 120),  // 4 ay
        "1y" => ("1d", 450),  // ~15 ay
        "max" => ("1w", 1000),
        _ => ("1d", 120),
    }
}

/// Range → Yahoo (range, interval). Yahoo range stringleri trading day bazlı —
/// chart'ın asked range'inden fazla iste ki nearest_at_or_before lookup'larında
/// eksik kalmasın (özellikle hisse weekend/tatil günlerinde).
fn yahoo_params(range: &str) -> (&'static str, &'static str) {
    match range {
        "1d" => ("2d", "5m"),
        "1w" => ("1mo", "1h"),
        "1m" => ("3mo", "1d"),
        "3m" => ("6mo", "1d"),
        "1y" => ("2y", "1d"),
        "max" => ("max", "1wk"),
        _ => ("6mo", "1d"),
    }
}

/// Range → CoinGecko days. Buffer eklenmiş — fetch geriye 1.3x kadar uzanır.
fn coingecko_days(range: &str) -> &'static str {
    match range {
        "1d" => "2",
        "1w" => "14",
        "1m" => "45",
        "3m" => "120",
        "1y" => "450",
        "max" => "max",
        _ => "120",
    }
}

/// Range → Frankfurter (from_iso, to_iso) — bugünden geri
fn frankfurter_range(range: &str) -> (String, String) {
    let now = chrono::Utc::now().date_naive();
    let from = match range {
        "1d" => now,
        "1w" => now - chrono::Duration::days(7),
        "1m" => now - chrono::Duration::days(30),
        "3m" => now - chrono::Duration::days(90),
        "1y" => now - chrono::Duration::days(365),
        "max" => now - chrono::Duration::days(365 * 10),
        _ => now - chrono::Duration::days(90),
    };
    (from.format("%Y-%m-%d").to_string(), now.format("%Y-%m-%d").to_string())
}

async fn read_cache(
    pool: &SqlitePool,
    asset_id: i64,
    range: &str,
) -> AppResult<Option<(Vec<(i64, f64)>, i64)>> {
    let row: Option<(String, i64)> = sqlx::query_as(
        "SELECT data, fetched_at FROM price_history WHERE asset_id = ? AND range = ?",
    )
    .bind(asset_id)
    .bind(range)
    .fetch_optional(pool)
    .await?;
    let Some((data_json, fetched_at)) = row else {
        return Ok(None);
    };
    let data: Vec<(i64, f64)> = serde_json::from_str(&data_json).unwrap_or_default();
    Ok(Some((data, fetched_at)))
}

async fn write_cache(
    pool: &SqlitePool,
    asset_id: i64,
    range: &str,
    points: &[(i64, f64)],
) -> AppResult<()> {
    let json = serde_json::to_string(points)?;
    sqlx::query(
        "INSERT INTO price_history (asset_id, range, data, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(asset_id, range) DO UPDATE SET
            data = excluded.data,
            fetched_at = excluded.fetched_at",
    )
    .bind(asset_id)
    .bind(range)
    .bind(&json)
    .bind(now_secs())
    .execute(pool)
    .await?;
    Ok(())
}

async fn fetch_fresh(
    pool: &SqlitePool,
    asset_id: i64,
    asset_type: &str,
    symbol: &str,
    external_id: Option<&str>,
    range: &str,
) -> AppResult<(Vec<(i64, f64)>, String)> {
    match asset_type {
        "crypto" => {
            // Önce Binance, fail olursa CoinGecko
            let (interval, limit) = binance_params(range);
            match crate::services::binance_rest::fetch_klines(symbol, interval, limit).await {
                Ok(v) if !v.is_empty() => return Ok((v, "binance".into())),
                Ok(_) => log::warn!("[birik] binance klines empty for {symbol} {range}"),
                Err(e) => log::warn!("[birik] binance klines failed for {symbol}: {e}"),
            }
            let cg_id = external_id.unwrap_or(symbol);
            let days = coingecko_days(range);
            match crate::services::coingecko::fetch_market_chart(cg_id, days).await {
                Ok(v) if !v.is_empty() => Ok((v, "coingecko".into())),
                Ok(_) => Err(AppError::external(format!(
                    "Kripto için {symbol} {range} veri yok (Binance + CoinGecko boş)"
                ))),
                Err(e) => Err(e),
            }
        }
        "stock" | "commodity" => {
            // Yahoo. external_id varsa onu kullan (Yahoo ticker tam formu)
            let yahoo_sym = external_id.unwrap_or(symbol);
            let (yr, yi) = yahoo_params(range);
            match crate::services::yahoo::fetch_chart(yahoo_sym, yr, yi).await {
                Ok(v) if !v.is_empty() => Ok((v, "yahoo".into())),
                Ok(_) => Err(AppError::external(format!(
                    "Yahoo {yahoo_sym} {range} boş döndü"
                ))),
                Err(e) => Err(e),
            }
        }
        "fx" => {
            // Frankfurter range — symbol = currency code (örn TRY)
            let (from, to) = frankfurter_range(range);
            // Asset semantiği: 1 birim {symbol} kaç USD eder
            // Frankfurter base=USD ile: 1 USD = X {symbol}, biz 1/X istiyoruz
            // fetch_range_to_usd zaten bunu yapıyor (1 currency = X USD)
            let v = crate::services::frankfurter::fetch_range_to_usd(&from, &to, symbol).await?;
            if v.is_empty() {
                return Err(AppError::external(format!(
                    "Frankfurter {symbol} {range} boş döndü"
                )));
            }
            Ok((v, "frankfurter".into()))
        }
        _ => Err(AppError::external(format!(
            "Bilinmeyen asset tipi: {asset_type}"
        ))),
    }
    .map(|(points, source)| {
        // Cache yaz
        let pool_clone = pool.clone();
        let range_str = range.to_string();
        let points_clone = points.clone();
        tauri::async_runtime::spawn(async move {
            let _ = write_cache(&pool_clone, asset_id, &range_str, &points_clone).await;
        });
        (points, source)
    })
}

/// State'siz versiyon — internal hesap için (örn. portfolio history hypothetical).
pub async fn fetch_asset_history_inner(
    pool: &SqlitePool,
    asset_id: i64,
    range: &str,
) -> AppResult<(Vec<(i64, f64)>, String, bool, i64)> {
    let asset: Option<(String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT symbol, name, type, external_id FROM assets WHERE id = ?",
    )
    .bind(asset_id)
    .fetch_optional(pool)
    .await?;
    let (symbol, _name, asset_type, external_id) = asset
        .ok_or_else(|| AppError::not_found(format!("Varlık bulunamadı: id={asset_id}")))?;

    if let Some((data, fetched_at)) = read_cache(pool, asset_id, range).await? {
        let age = now_secs() - fetched_at;
        if age < ttl_seconds(range) && !data.is_empty() {
            return Ok((data, "cache".into(), true, fetched_at));
        }
    }

    let (points, source) = fetch_fresh(
        pool,
        asset_id,
        &asset_type,
        &symbol,
        external_id.as_deref(),
        range,
    )
    .await?;
    Ok((points, source, false, now_secs()))
}

#[tauri::command]
pub async fn fetch_asset_history(
    db: State<'_, Db>,
    asset_id: i64,
    range: String,
) -> AppResult<AssetHistory> {
    let (points, source, cache_hit, fetched_at) =
        fetch_asset_history_inner(&db.pool, asset_id, &range).await?;
    Ok(AssetHistory {
        asset_id,
        range,
        points,
        source,
        cache_hit,
        fetched_at,
    })
}

/* ----------------------------------------------------------------
 * Portfolio history
 * ---------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize)]
pub struct PortfolioHistoryPoint {
    pub ts: i64,
    pub value: f64,
    /// `true` = bu noktanın değeri snapshot'tan gelmedi, hypothetical hesap
    /// (bugünkü bakiye × o günkü fiyat). `false` = gerçek snapshot.
    pub is_hypothetical: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortfolioHistory {
    pub portfolio_id: Option<i64>,
    pub range: String,
    pub display_currency: String,
    pub points: Vec<PortfolioHistoryPoint>,
    /// Snapshot count — gerçek nokta sayısı (hypothetical hariç)
    pub samples: i64,
}

fn range_to_days(range: &str) -> i64 {
    match range {
        "1d" => 1,
        "1w" => 7,
        "1m" => 30,
        "3m" => 90,
        "1y" => 365,
        "max" => 365 * 10,
        _ => 90,
    }
}

/// Asc sıralı `(ts, val)` listesinden `target_ts`'ye ≤ olan son noktanın value'su.
/// Yoksa None (liste boşsa).
fn nearest_at_or_before(points: &[(i64, f64)], target_ts: i64) -> Option<f64> {
    if points.is_empty() {
        return None;
    }
    let mut last: Option<f64> = None;
    for (ts, v) in points {
        if *ts <= target_ts {
            last = Some(*v);
        } else {
            break;
        }
    }
    last
}

/// `nearest_at_or_before` ama fallback ile: target_ts tüm noktalardan eskiyse
/// (yani lookup None dönerse), en eski mevcut noktayı kullan. Use case:
/// - USDT gibi stablecoin'lerde binance_rest tek nokta (NOW) döner; tarihsel
///   günlerde bu fallback ~1.0'ı projekte eder
/// - Yeni eklenen asset'in fiyat history'si chart range'inden kısaysa, eski
///   günler için ilk bilinen fiyatı kullan (best-effort, smooth chart)
fn nearest_price_lenient(points: &[(i64, f64)], target_ts: i64) -> Option<f64> {
    nearest_at_or_before(points, target_ts)
        .or_else(|| points.first().map(|(_, v)| *v))
}

/// TCMB/Frankfurter bugünkü rates'ten "1 X = ? USD" hesabı. Historical FX
/// series başarısız olduğunda yaklaşık fallback olarak kullanılır.
fn today_fx_to_usd(
    currency: &str,
    current_fx: &crate::services::tcmb::FxRates,
) -> Option<f64> {
    let upper = currency.to_uppercase();
    if upper == "USD" {
        return Some(1.0);
    }
    // current_fx.rates[X] = 1 X için TRY karşılığı. 1 USD = rates["USD"] TRY.
    let usd_try = current_fx.rates.get("USD").copied()?;
    if usd_try <= 0.0 {
        return None;
    }
    if upper == "TRY" {
        return Some(1.0 / usd_try);
    }
    let ccy_try = current_fx.rates.get(&upper).copied()?;
    if ccy_try <= 0.0 {
        return None;
    }
    Some(ccy_try / usd_try)
}

#[tauri::command]
pub async fn fetch_portfolio_history(
    db: State<'_, Db>,
    portfolio_id: Option<i64>,
    range: String,
    display_currency: String,
) -> AppResult<PortfolioHistory> {
    let display = display_currency.to_uppercase();
    let days = range_to_days(&range);
    let now = chrono::Utc::now();
    let start = now - chrono::Duration::days(days);
    let from_date = start.format("%Y-%m-%d").to_string();

    #[derive(sqlx::FromRow)]
    struct Snap {
        date: String,
        total_value: f64,
    }

    // Snapshot'lar — display currency'de varsa öncelik, yoksa USD'den convert
    let snaps_native: Vec<Snap> = match portfolio_id {
        Some(pid) => sqlx::query_as(
            "SELECT date, total_value FROM portfolio_snapshots
             WHERE portfolio_id = ? AND currency = ? AND date >= ?
             ORDER BY date ASC",
        )
        .bind(pid)
        .bind(&display)
        .bind(&from_date)
        .fetch_all(&db.pool)
        .await?,
        None => sqlx::query_as(
            "SELECT date, SUM(total_value) AS total_value
             FROM portfolio_snapshots
             WHERE currency = ? AND date >= ?
             GROUP BY date ORDER BY date ASC",
        )
        .bind(&display)
        .bind(&from_date)
        .fetch_all(&db.pool)
        .await?,
    };

    // 1) Snapshot map: date_str → display currency value
    use std::collections::HashMap;
    let mut snapshot_by_date: HashMap<String, f64> = HashMap::new();
    if !snaps_native.is_empty() {
        for s in &snaps_native {
            snapshot_by_date.insert(s.date.clone(), s.total_value);
        }
    } else {
        // USD snapshot'larını çek + bugünkü FX ile display'e dönüştür
        let usd_snaps: Vec<Snap> = match portfolio_id {
            Some(pid) => sqlx::query_as(
                "SELECT date, total_value FROM portfolio_snapshots
                 WHERE portfolio_id = ? AND currency = 'USD' AND date >= ?
                 ORDER BY date ASC",
            )
            .bind(pid)
            .bind(&from_date)
            .fetch_all(&db.pool)
            .await?,
            None => sqlx::query_as(
                "SELECT date, SUM(total_value) AS total_value
                 FROM portfolio_snapshots
                 WHERE currency = 'USD' AND date >= ?
                 GROUP BY date ORDER BY date ASC",
            )
            .bind(&from_date)
            .fetch_all(&db.pool)
            .await?,
        };

        if !usd_snaps.is_empty() {
            if display == "USD" {
                for s in &usd_snaps {
                    snapshot_by_date.insert(s.date.clone(), s.total_value);
                }
            } else {
                let mut fx = crate::services::fx::fetch_rates().await?;
                crate::commands::calc::enrich_with_crypto(&mut fx, &display, &db.pool).await;
                for s in &usd_snaps {
                    let v = crate::commands::calc::convert(
                        s.total_value,
                        "USD",
                        &display,
                        Some(&fx),
                    );
                    snapshot_by_date.insert(s.date.clone(), v);
                }
            }
        }
    }

    // 2) Hypothetical hesabı için asset listesi + bugünkü bakiyeler
    #[derive(sqlx::FromRow)]
    struct AssetRow {
        id: i64,
        currency: String,
        #[sqlx(rename = "type")]
        asset_type: String,
    }
    let assets: Vec<AssetRow> = match portfolio_id {
        Some(pid) => sqlx::query_as(
            "SELECT id, currency, type FROM assets WHERE portfolio_id = ?",
        )
        .bind(pid)
        .fetch_all(&db.pool)
        .await?,
        None => sqlx::query_as("SELECT id, currency, type FROM assets")
            .fetch_all(&db.pool)
            .await?,
    };

    // Onboarding penceresi: ilk asset.created_at + 7 gün. Bu pencerede oluşan
    // snapshot'lar görmezden gelinir (kullanıcı ardışık günlerde varlık ekledikçe
    // ani sıçramalar olmasın), hypothetical hesap devreye girer.
    const ONBOARDING_DAYS: i64 = 7;
    let first_asset_created: Option<i64> = match portfolio_id {
        Some(pid) => sqlx::query_scalar::<_, Option<i64>>(
            "SELECT MIN(created_at) FROM assets WHERE portfolio_id = ?",
        )
        .bind(pid)
        .fetch_one(&db.pool)
        .await?,
        None => {
            sqlx::query_scalar::<_, Option<i64>>("SELECT MIN(created_at) FROM assets")
                .fetch_one(&db.pool)
                .await?
        }
    };
    let onboarding_end_date: Option<chrono::NaiveDate> = first_asset_created.and_then(|t| {
        chrono::DateTime::<chrono::Utc>::from_timestamp(t, 0)
            .map(|dt| dt.date_naive() + chrono::Duration::days(ONBOARDING_DAYS))
    });

    // Asset bazlı hesap önbellekleri
    struct AssetCalc {
        balance: f64,
        currency: String,
        // (timestamp_ms, price_in_asset_currency) — asc sıralı
        prices: Vec<(i64, f64)>,
    }

    // Asset history fetch + position hesabı paralel. History boş asset'ler
    // (USDT single-point, USD-fx Frankfurter boş, Yahoo fail) cache'ten
    // single-point fallback alır — her tarihsel günde lenient lookup ile
    // sabit projekte edilir. Bu sayede today live calc'la apples-to-apples.
    let range_str = range.clone();
    let pool_clone = db.pool.clone();
    let asset_futures = assets.iter().map(|a| {
        let pool = pool_clone.clone();
        let range = range_str.clone();
        let asset_id = a.id;
        let asset_currency = a.currency.to_uppercase();
        let asset_type = a.asset_type.clone();
        async move {
            let txns: Vec<crate::db::models::Transaction> = sqlx::query_as(
                "SELECT id, asset_id, date, type, source, quantity, price, fee, note,
                        is_deleted, created_at, fx_to_usd, platform, expected_yield_pct
                 FROM transactions WHERE asset_id = ? AND is_deleted = 0",
            )
            .bind(asset_id)
            .fetch_all(&pool)
            .await
            .ok()?;
            let pos = crate::commands::calc::position_from_transactions(&txns);
            if pos.balance.abs() < 1e-9 {
                return None;
            }

            // 1) Historical fetch dene
            let mut prices = match fetch_asset_history_inner(&pool, asset_id, &range).await {
                Ok((p, _, _, _)) => p,
                Err(e) => {
                    log::warn!(
                        "[birik] portfolio history: asset {asset_id} price fetch fail: {e}"
                    );
                    vec![]
                }
            };

            // 2) History boşsa cache'ten single-point yap (lenient lookup geri
            //    projekte edecek). Cache currency price_currency olabilir
            //    (asset.currency'den farklı, örn fx asset USD cache=TRY).
            //    Bu durumda price'ı asset.currency'e convert et — strict-resolve
            //    sonra balance × price × fx_to_usd yapacak ve uyumlu olacak.
            let mut effective_currency = asset_currency.clone();
            if prices.is_empty() {
                if let Ok(Some(cached)) = crate::services::cache::get(&pool, asset_id).await
                {
                    let now_ms = chrono::Utc::now().timestamp_millis();
                    prices = vec![(now_ms, cached.price)];
                    // Cache currency'ye geçiş — fx_series bu currency için
                    // lookup yapacak. Örn USD fx asset için cache=TRY ise
                    // effective_currency=TRY, fx_series TRY için fetch edilir.
                    effective_currency = cached.currency.to_uppercase();
                    log::info!(
                        "[birik] portfolio history: asset {asset_id} ({asset_type}) using cache fallback ({effective_currency})"
                    );
                }
            }

            if prices.is_empty() {
                return None;
            }

            Some(AssetCalc {
                balance: pos.balance,
                currency: effective_currency,
                prices,
            })
        }
    });
    let asset_calcs: Vec<AssetCalc> = futures_util::future::join_all(asset_futures)
        .await
        .into_iter()
        .flatten()
        .collect();

    // 3) Currency'lerin günlük FX_to_USD serileri — paralel fetch
    let from_iso = start.format("%Y-%m-%d").to_string();
    let to_iso = now.format("%Y-%m-%d").to_string();
    let distinct_currencies: std::collections::HashSet<String> = asset_calcs
        .iter()
        .filter(|ac| ac.currency != "USD")
        .map(|ac| ac.currency.clone())
        .collect();
    let fx_futures = distinct_currencies.iter().map(|c| {
        let from_iso = from_iso.clone();
        let to_iso = to_iso.clone();
        let currency = c.clone();
        async move {
            let result = crate::services::frankfurter::fetch_range_to_usd(
                &from_iso,
                &to_iso,
                &currency,
            )
            .await;
            let series = match result {
                Ok(v) if !v.is_empty() => v,
                _ => {
                    log::warn!(
                        "[birik] portfolio history: fx range fetch fail for {currency}"
                    );
                    vec![]
                }
            };
            (currency, series)
        }
    });
    let fx_results = futures_util::future::join_all(fx_futures).await;
    let mut fx_series: HashMap<String, Vec<(i64, f64)>> = HashMap::new();
    for (c, v) in fx_results {
        fx_series.insert(c, v);
    }

    // Bugünkü FX rates — iki amaçla kullanılır:
    //   a) USD → display dönüşümü (hypothetical sonucu USD bazlı)
    //   b) Historical FX serisi başarısız olursa fallback (today's rate)
    // Asset_calcs içinde non-USD currency varsa veya display != USD ise fetch et.
    let any_non_usd = asset_calcs.iter().any(|ac| ac.currency != "USD");
    let need_current_fx = display != "USD" || any_non_usd;
    let current_fx = if need_current_fx {
        match crate::services::fx::fetch_rates().await {
            Ok(mut rates) => {
                if display != "USD" {
                    crate::commands::calc::enrich_with_crypto(&mut rates, &display, &db.pool).await;
                }
                Some(rates)
            }
            Err(e) => {
                log::warn!("[birik] portfolio history: current fx fetch fail: {e}");
                None
            }
        }
    } else {
        None
    };

    // 4) Range içindeki her gün (start..=today) için nokta üret
    //
    // Strict resolve: hypothetical hesabında bir asset'in fiyat veya FX
    // history'si o günü kapsamıyorsa o günü tamamen skip et. Eskiden permissive
    // idi (eksik asset = 0); ilk gün artifact'i (örn. 426 USD = sadece 1
    // asset resolve etmiş diğerleri 0 sayılmış) bu yüzdendi.
    //
    // Today istisnası: bugünün point'i historical price feed'inden değil,
    // canlı `calculate_portfolio_inner` ile hesaplanır — dashboard'da görünen
    // değerle birebir uyumlu olsun. Snapshot da skip edilir (sabahki stale
    // değer kullanılmasın).
    let mut points: Vec<PortfolioHistoryPoint> = Vec::with_capacity(days as usize + 1);
    let mut samples: i64 = 0;
    let today_naive = now.date_naive();
    let start_naive = start.date_naive();

    let mut day = start_naive;
    while day < today_naive {
        let day_str = day.format("%Y-%m-%d").to_string();
        // Lookup timestamp: gün sonu (ertesi gün 00:00 UTC). Binance daily
        // candle'ı (open=00:00) bu sayede o günün close'unu döner. Yahoo
        // daily candle'ı (timestamp=market open ~13:30 UTC) da o günün
        // close'una eşleşir. Eskiden 12:00 UTC sorulduğunda Yahoo dünün
        // candle'ını döndürüyordu → 1 gün eski fiyat artifact'i.
        let day_ms = day
            .succ_opt()
            .and_then(|d| d.and_hms_opt(0, 0, 0))
            .map(|d| d.and_utc().timestamp_millis())
            .unwrap_or(0);
        // Display timestamp gün ortası — chart X ekseni günün etiketini
        // doğru göstersin (ertesi gün 00:00 ms görsel olarak ertesi gün
        // gibi okunmasın).
        let display_ms = day
            .and_hms_opt(12, 0, 0)
            .map(|d| d.and_utc().timestamp_millis())
            .unwrap_or(0);

        let in_onboarding = onboarding_end_date
            .map(|end| day < end)
            .unwrap_or(false);
        let snapshot_value = if in_onboarding {
            None
        } else {
            snapshot_by_date.get(&day_str).copied()
        };

        if let Some(v) = snapshot_value {
            points.push(PortfolioHistoryPoint {
                ts: display_ms,
                value: v,
                is_hypothetical: false,
            });
            samples += 1;
        } else if !asset_calcs.is_empty() {
            // Strict resolve: tüm asset'lerin o gün için price + fx verisi
            // OLMALI. Aksi takdirde grafiğin o günü skip edilir (alttan kopuk
            // olmasındansa, kullanıcıya açıkça eksik göstermek doğru).
            let mut total_usd = 0.0;
            let mut all_resolved = true;
            for ac in &asset_calcs {
                // Lenient lookup: önce ≤ target, yoksa ilk mevcut noktayı projekte et.
                // Bu olmadan stablecoin (USDT) veya yeni eklenmiş asset bütün tarihsel
                // günleri killer (single-point veya kısa history nedeniyle).
                let price = nearest_price_lenient(&ac.prices, day_ms);
                let fx_to_usd = if ac.currency == "USD" {
                    Some(1.0)
                } else {
                    fx_series
                        .get(&ac.currency)
                        .and_then(|s| nearest_price_lenient(s, day_ms))
                        .or_else(|| {
                            current_fx
                                .as_ref()
                                .and_then(|fx| today_fx_to_usd(&ac.currency, fx))
                        })
                };
                match (price, fx_to_usd) {
                    (Some(p), Some(fx)) => {
                        total_usd += ac.balance * p * fx;
                    }
                    _ => {
                        all_resolved = false;
                        break;
                    }
                }
            }
            if all_resolved {
                let value_in_display = match &current_fx {
                    Some(fx) => crate::commands::calc::convert(
                        total_usd,
                        "USD",
                        &display,
                        Some(fx),
                    ),
                    None => total_usd,
                };
                points.push(PortfolioHistoryPoint {
                    ts: display_ms,
                    value: value_in_display,
                    is_hypothetical: true,
                });
            }
        }
        day = match day.succ_opt() {
            Some(d) => d,
            None => break,
        };
    }

    // Today: tarihsel günlerle BİREBİR aynı hesap motorunu kullan
    // (asset_calcs + nearest_price_lenient). Lookup timestamp gelecekte —
    // her asset'in en son fiyatı dönecek. Bu sayede dashboard ile küçük
    // bir farkı tolere ediyoruz (1d Binance candle'ı vs canlı cache),
    // ama tarihsel günlerle pürüzsüz devamlılık sağlıyoruz.
    let today_display_ms = today_naive
        .and_hms_opt(12, 0, 0)
        .map(|d| d.and_utc().timestamp_millis())
        .unwrap_or(0);
    // Lookup için yarın 00:00 UTC — en son mevcut fiyatı yakalar
    let today_lookup_ms = today_naive
        .succ_opt()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|d| d.and_utc().timestamp_millis())
        .unwrap_or(0);

    if !asset_calcs.is_empty() {
        let mut total_usd = 0.0;
        let mut all_resolved = true;
        for ac in &asset_calcs {
            let price = nearest_price_lenient(&ac.prices, today_lookup_ms);
            let fx_to_usd = if ac.currency == "USD" {
                Some(1.0)
            } else {
                fx_series
                    .get(&ac.currency)
                    .and_then(|s| nearest_price_lenient(s, today_lookup_ms))
                    .or_else(|| {
                        current_fx
                            .as_ref()
                            .and_then(|fx| today_fx_to_usd(&ac.currency, fx))
                    })
            };
            match (price, fx_to_usd) {
                (Some(p), Some(fx)) => total_usd += ac.balance * p * fx,
                _ => {
                    all_resolved = false;
                    break;
                }
            }
        }
        if all_resolved {
            let value_in_display = match &current_fx {
                Some(fx) => crate::commands::calc::convert(
                    total_usd,
                    "USD",
                    &display,
                    Some(fx),
                ),
                None => total_usd,
            };
            points.push(PortfolioHistoryPoint {
                ts: today_display_ms,
                value: value_in_display,
                // Tarihsel günlerle aynı motoru kullanıyor (asset_calcs + lenient
                // lookup). Hepsini aynı seri olarak çiz — frontend "real" vs
                // "hypothetical" çizgileri arasında tek-noktalı kopukluk
                // yaratmasın.
                is_hypothetical: true,
            });
            samples += 1;
        }
    }

    Ok(PortfolioHistory {
        portfolio_id,
        range,
        display_currency: display,
        points,
        samples,
    })
}
