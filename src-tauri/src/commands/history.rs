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

/// Range → Binance (interval, limit)
fn binance_params(range: &str) -> (&'static str, usize) {
    match range {
        "1d" => ("5m", 288),
        "1w" => ("1h", 168),
        "1m" => ("4h", 180),
        "3m" => ("1d", 90),
        "1y" => ("1d", 365),
        "max" => ("1w", 1000),
        _ => ("1d", 90),
    }
}

/// Range → Yahoo (range, interval)
fn yahoo_params(range: &str) -> (&'static str, &'static str) {
    match range {
        "1d" => ("1d", "5m"),
        "1w" => ("5d", "1h"),
        "1m" => ("1mo", "1d"),
        "3m" => ("3mo", "1d"),
        "1y" => ("1y", "1d"),
        "max" => ("max", "1wk"),
        _ => ("3mo", "1d"),
    }
}

/// Range → CoinGecko days
fn coingecko_days(range: &str) -> &'static str {
    match range {
        "1d" => "1",
        "1w" => "7",
        "1m" => "30",
        "3m" => "90",
        "1y" => "365",
        "max" => "max",
        _ => "90",
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
/// Yoksa None (target tüm noktalardan eskiyse veya liste boşsa).
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
    }
    let assets: Vec<AssetRow> = match portfolio_id {
        Some(pid) => sqlx::query_as(
            "SELECT id, currency FROM assets WHERE portfolio_id = ?",
        )
        .bind(pid)
        .fetch_all(&db.pool)
        .await?,
        None => sqlx::query_as("SELECT id, currency FROM assets")
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
    let mut asset_calcs: Vec<AssetCalc> = Vec::with_capacity(assets.len());

    for a in &assets {
        // Bugünkü bakiye
        let txns: Vec<crate::db::models::Transaction> = sqlx::query_as(
            "SELECT id, asset_id, date, type, source, quantity, price, fee, note,
                    is_deleted, created_at, fx_to_usd, platform
             FROM transactions WHERE asset_id = ? AND is_deleted = 0",
        )
        .bind(a.id)
        .fetch_all(&db.pool)
        .await?;
        let pos = crate::commands::calc::position_from_transactions(&txns);
        if pos.balance.abs() < 1e-9 {
            continue;
        }

        // Asset price history (range için cache + fetch)
        let prices = match fetch_asset_history_inner(&db.pool, a.id, &range).await {
            Ok((p, _, _, _)) => p,
            Err(e) => {
                log::warn!(
                    "[birik] portfolio history: asset {} price fetch fail: {e}",
                    a.id
                );
                continue;
            }
        };
        if prices.is_empty() {
            continue;
        }

        asset_calcs.push(AssetCalc {
            balance: pos.balance,
            currency: a.currency.to_uppercase(),
            prices,
        });
    }

    // 3) Currency'lerin günlük FX_to_USD serileri (asset.currency != USD ise)
    let mut fx_series: HashMap<String, Vec<(i64, f64)>> = HashMap::new();
    let from_iso = start.format("%Y-%m-%d").to_string();
    let to_iso = now.format("%Y-%m-%d").to_string();
    for ac in &asset_calcs {
        if ac.currency == "USD" || fx_series.contains_key(&ac.currency) {
            continue;
        }
        match crate::services::frankfurter::fetch_range_to_usd(
            &from_iso,
            &to_iso,
            &ac.currency,
        )
        .await
        {
            Ok(v) if !v.is_empty() => {
                fx_series.insert(ac.currency.clone(), v);
            }
            _ => {
                log::warn!(
                    "[birik] portfolio history: fx range fetch fail for {}",
                    ac.currency
                );
                fx_series.insert(ac.currency.clone(), vec![]);
            }
        }
    }

    // USD → display dönüşümü için bugünkü FX (hypothetical sonucu USD'de hesaplanıyor)
    let current_fx = if display != "USD" {
        let mut rates = crate::services::fx::fetch_rates().await?;
        crate::commands::calc::enrich_with_crypto(&mut rates, &display, &db.pool).await;
        Some(rates)
    } else {
        None
    };

    // 4) Range içindeki her gün (start..=today) için nokta üret
    let mut points: Vec<PortfolioHistoryPoint> = Vec::with_capacity(days as usize + 1);
    let mut samples: i64 = 0;
    let today_naive = now.date_naive();
    let start_naive = start.date_naive();

    let mut day = start_naive;
    while day <= today_naive {
        let day_str = day.format("%Y-%m-%d").to_string();
        let day_ms = day
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
                ts: day_ms,
                value: v,
                is_hypothetical: false,
            });
            samples += 1;
        } else if !asset_calcs.is_empty() {
            // Hypothetical: bugünkü bakiyeler × o günkü fiyat × o günkü fx_to_usd
            let mut total_usd = 0.0;
            let mut all_resolved = true;
            for ac in &asset_calcs {
                let price = match nearest_at_or_before(&ac.prices, day_ms) {
                    Some(p) => p,
                    None => {
                        all_resolved = false;
                        break;
                    }
                };
                let fx_to_usd = if ac.currency == "USD" {
                    1.0
                } else {
                    match fx_series.get(&ac.currency) {
                        Some(s) => match nearest_at_or_before(s, day_ms) {
                            Some(v) => v,
                            None => {
                                all_resolved = false;
                                break;
                            }
                        },
                        None => {
                            all_resolved = false;
                            break;
                        }
                    }
                };
                total_usd += ac.balance * price * fx_to_usd;
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
                    ts: day_ms,
                    value: value_in_display,
                    is_hypothetical: true,
                });
            }
            // resolved olmayan günleri (range çok geri, asset history o kadar geriye gitmiyor) atla
        }
        day = day.succ_opt().unwrap_or(today_naive);
        if day > today_naive {
            break;
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
