//! Arka plan alarm kontrol döngüsü — PLAN §6.1.F + §12 Faz 6.
//!
//! Adaptif tick:
//!   - Default: 1 saat
//!   - Aktif alarmların en yakını cache fiyatına ≤ %5 mesafedeyse: 30 dk
//!   - ≤ %2 mesafedeyse: 15 dk
//!
//! Her tick'te:
//!   1. Tüm portföylerin asset'leri için fiyat çek + cache güncelle
//!   2. Aktif alarmları kontrol et + tetiklenenler için OS notification
//!   3. Bir sonraki tick için interval'i alarm yakınlığına göre belirle
//!
//! Hata olursa loop kırılmaz, sonraki tick'te tekrar dener (defansif).

use std::time::Duration;

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::commands::alert::check_alerts_inner;
use crate::services::{binance_rest, cache, coingecko, tcmb, yahoo, Db};

const TICK_DEFAULT_SECS: u64 = 60 * 60; // 1 saat
const TICK_NEAR_SECS: u64 = 30 * 60; // %5 mesafede
const TICK_CLOSE_SECS: u64 = 15 * 60; // %2 mesafede

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Boot'tan hemen sonra ilk run'ı geciktirme — frontend zaten boot'ta
        // manuel refresh yapıyor, biz arka planda 1 saat sonra başlayalım.
        tokio::time::sleep(Duration::from_secs(TICK_DEFAULT_SECS)).await;

        loop {
            let next_interval = match tick(&app).await {
                Ok(secs) => secs,
                Err(e) => {
                    log::warn!("[birik] alarm tick failed: {e}");
                    TICK_DEFAULT_SECS
                }
            };
            tokio::time::sleep(Duration::from_secs(next_interval)).await;
        }
    });
}

/// Tek tick — fiyatları tazele, alarmları kontrol et, OS bildirimi gönder.
/// Dönüş değeri: bir sonraki tick için saniye (alarm yakınlığına göre adaptif).
async fn tick(app: &AppHandle) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
    let db = app.state::<Db>();
    let pool = db.pool.clone();

    refresh_prices_silent(&pool).await?;

    let triggered = check_alerts_inner(&pool).await?;

    for t in triggered {
        let title = "Birik fiyat alarmı";
        let body = match t.condition.as_str() {
            "above" => format!(
                "{} {} eşiğini geçti (güncel: {:.2} {})",
                t.asset_symbol, t.threshold, t.current_price, t.currency
            ),
            "below" => format!(
                "{} {} eşiğinin altına düştü (güncel: {:.2} {})",
                t.asset_symbol, t.threshold, t.current_price, t.currency
            ),
            _ => format!("{} alarmı tetiklendi", t.asset_symbol),
        };

        if let Err(e) = app
            .notification()
            .builder()
            .title(title)
            .body(&body)
            .show()
        {
            log::warn!("[birik] notification failed: {e}");
        }
    }

    Ok(next_interval(&pool).await)
}

/// Aktif alarmların threshold'una en yakın olanın yüzde mesafesine göre
/// sonraki tick aralığı:
///   ≤ %2  → 15 dk
///   ≤ %5  → 30 dk
///   diğer → 1 saat
///
/// Mesafe ölçümü: |price - threshold| / threshold * 100. Price ya da threshold
/// uyumsuz para biriminde ise o alarm skip edilir (sade tutuyoruz; FX bridge
/// pahalı + frequent ticks zaten 5 dk altına inmiyor).
async fn next_interval(pool: &SqlitePool) -> u64 {
    #[derive(sqlx::FromRow)]
    struct Row {
        threshold: f64,
        currency: String,
        cache_price: Option<f64>,
        cache_currency: Option<String>,
    }
    let rows: Vec<Row> = match sqlx::query_as(
        "SELECT pa.threshold, pa.currency,
                pc.price as cache_price, pc.currency as cache_currency
         FROM price_alerts pa
         LEFT JOIN price_cache pc ON pc.asset_id = pa.asset_id
         WHERE pa.active = 1",
    )
    .fetch_all(pool)
    .await
    {
        Ok(v) => v,
        Err(_) => return TICK_DEFAULT_SECS,
    };

    let mut min_dist_pct: Option<f64> = None;
    for r in rows {
        let Some(price) = r.cache_price else { continue };
        // Aynı currency değilse skip — sade tutuyoruz
        if r.cache_currency.as_deref().map(|s| s.to_uppercase())
            != Some(r.currency.to_uppercase())
        {
            continue;
        }
        if r.threshold <= 0.0 {
            continue;
        }
        let dist = ((price - r.threshold).abs() / r.threshold) * 100.0;
        min_dist_pct = Some(min_dist_pct.map(|m| m.min(dist)).unwrap_or(dist));
    }

    match min_dist_pct {
        Some(d) if d <= 2.0 => TICK_CLOSE_SECS,
        Some(d) if d <= 5.0 => TICK_NEAR_SECS,
        _ => TICK_DEFAULT_SECS,
    }
}

/// Tüm asset'ler için cache TTL'ne göre fiyat çek (force=false).
/// Hata olursa o asset atlanır, loop devam eder.
async fn refresh_prices_silent(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use crate::db::models::Asset;

    let assets: Vec<Asset> = sqlx::query_as(
        "SELECT id, portfolio_id, symbol, name, type, currency, external_id, created_at,
                expected_yield_pct, icon_url, platform
         FROM assets",
    )
    .fetch_all(pool)
    .await?;

    let mut fx: Option<tcmb::FxRates> = None;

    for a in assets {
        // Cache fresh ise atla
        if let Some(c) = cache::get(pool, a.id).await? {
            if cache::is_fresh(&c) {
                continue;
            }
        }

        let result = match a.asset_type.as_str() {
            "crypto" => {
                // Binance → CoinGecko → Yahoo (refresh_all_prices ile aynı zincir)
                match binance_rest::fetch_quote(&a.symbol).await {
                    Ok(q) => Some((q.usd_price, "USD".to_string(), q.change_24h_pct)),
                    Err(_) => match coingecko::fetch_price(
                        a.external_id.as_deref().unwrap_or(a.symbol.as_str()),
                    )
                    .await
                    {
                        Ok(p) => Some((p.usd, "USD".to_string(), p.usd_24h_change)),
                        Err(_) => {
                            let y_sym = format!("{}-USD", a.symbol.to_uppercase());
                            yahoo::fetch_price(&y_sym).await.ok().map(|p| {
                                let pct = match p.previous_close {
                                    Some(prev) if prev > 0.0 => {
                                        Some((p.price - prev) / prev * 100.0)
                                    }
                                    _ => None,
                                };
                                (p.price, "USD".to_string(), pct)
                            })
                        }
                    },
                }
            }
            "stock" => yahoo::fetch_price(
                a.external_id.as_deref().unwrap_or(a.symbol.as_str()),
            )
            .await
            .ok()
            .map(|p| {
                let pct = match p.previous_close {
                    Some(prev) if prev > 0.0 => Some((p.price - prev) / prev * 100.0),
                    _ => None,
                };
                (p.price, p.currency, pct)
            }),
            "commodity" => {
                // Yahoo (external_id = futures sembolü) → TCMB fallback (XAU için)
                let yahoo_sym = a.external_id.as_deref().filter(|s| !s.is_empty());
                let mut got: Option<(f64, String, Option<f64>)> = None;
                if let Some(ys) = yahoo_sym {
                    got = yahoo::fetch_price(ys).await.ok().map(|p| {
                        let pct = match p.previous_close {
                            Some(prev) if prev > 0.0 => Some((p.price - prev) / prev * 100.0),
                            _ => None,
                        };
                        (p.price, p.currency, pct)
                    });
                }
                if got.is_none() {
                    if fx.is_none() {
                        fx = crate::services::fx::fetch_rates().await.ok();
                    }
                    got = fx
                        .as_ref()
                        .and_then(|r| r.rates.get(&a.symbol.to_uppercase()).copied())
                        .map(|v| (v, "TRY".to_string(), None));
                }
                got
            }
            "fx" => {
                if fx.is_none() {
                    fx = crate::services::fx::fetch_rates().await.ok();
                }
                fx.as_ref()
                    .and_then(|r| r.rates.get(&a.symbol.to_uppercase()).copied())
                    .map(|v| (v, "TRY".to_string(), None))
            }
            _ => None,
        };

        if let Some((price, currency, pct)) = result {
            let _ = cache::put(pool, a.id, price, &currency, pct).await;
        }
    }

    Ok(())
}
