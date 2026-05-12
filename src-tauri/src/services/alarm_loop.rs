//! Arka plan alarm kontrol döngüsü — PLAN §6.1.F + §12 Faz 6.
//!
//! Her 5 dk'da bir:
//!   1. Tüm portföylerin asset'leri için fiyat çek + cache güncelle
//!   2. Aktif alarmları kontrol et
//!   3. Tetiklenen alarmlar için OS notification gönder
//!
//! Tauri setup hook'unda spawn ediliyor; uygulama kapanana kadar çalışır.
//! Hata olursa loop kırılmaz, sonraki tick'te tekrar dener (defansif).

use std::time::Duration;

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::commands::alert::check_alerts_inner;
use crate::services::{binance_rest, cache, coingecko, tcmb, yahoo, Db};

const TICK_SECS: u64 = 5 * 60;

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Boot'tan hemen sonra ilk run'ı geciktirme — kullanıcı manuel
        // refresh ile başa kadar gitsin, biz arka planda 5 dk sonra
        // başlayalım.
        tokio::time::sleep(Duration::from_secs(TICK_SECS)).await;

        loop {
            if let Err(e) = tick(&app).await {
                log::warn!("[birik] alarm tick failed: {e}");
            }
            tokio::time::sleep(Duration::from_secs(TICK_SECS)).await;
        }
    });
}

async fn tick(app: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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

    Ok(())
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
            "crypto" => match binance_rest::fetch_quote(&a.symbol).await {
                Ok(q) => Some((q.usd_price, "USD".to_string(), q.change_24h_pct)),
                Err(_) => coingecko::fetch_price(
                    a.external_id.as_deref().unwrap_or(a.symbol.as_str()),
                )
                .await
                .ok()
                .map(|p| (p.usd, "USD".to_string(), p.usd_24h_change)),
            },
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
            "fx" | "commodity" => {
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
