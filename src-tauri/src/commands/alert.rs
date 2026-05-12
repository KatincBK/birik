use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

use crate::commands::now_secs;
use crate::db::models::PriceAlert;
use crate::error::{AppError, AppResult};
use crate::services::{tcmb, Db};

const VALID_CONDITIONS: &[&str] = &["above", "below"];

#[tauri::command]
pub async fn create_alert(
    db: State<'_, Db>,
    asset_id: i64,
    condition: String,
    threshold: f64,
    currency: String,
) -> AppResult<PriceAlert> {
    if !VALID_CONDITIONS.contains(&condition.as_str()) {
        return Err(AppError::validation(
            "Koşul 'above' ya da 'below' olmalı",
        ));
    }
    if threshold <= 0.0 {
        return Err(AppError::validation("Eşik değeri 0'dan büyük olmalı"));
    }
    let row: PriceAlert = sqlx::query_as(
        "INSERT INTO price_alerts (asset_id, condition, threshold, currency, active, triggered_at, created_at)
         VALUES (?, ?, ?, ?, 1, NULL, ?)
         RETURNING id, asset_id, condition, threshold, currency, active, triggered_at, created_at",
    )
    .bind(asset_id)
    .bind(&condition)
    .bind(threshold)
    .bind(currency.to_uppercase())
    .bind(now_secs())
    .fetch_one(&db.pool)
    .await?;
    Ok(row)
}

#[tauri::command]
pub async fn list_alerts(
    db: State<'_, Db>,
    portfolio_id: Option<i64>,
    only_active: Option<bool>,
) -> AppResult<Vec<PriceAlert>> {
    let only_active = only_active.unwrap_or(false);
    let rows: Vec<PriceAlert> = match (portfolio_id, only_active) {
        (Some(pid), true) => sqlx::query_as(
            "SELECT pa.id, pa.asset_id, pa.condition, pa.threshold, pa.currency,
                    pa.active, pa.triggered_at, pa.created_at
             FROM price_alerts pa
             JOIN assets a ON a.id = pa.asset_id
             WHERE a.portfolio_id = ? AND pa.active = 1
             ORDER BY pa.created_at DESC",
        )
        .bind(pid)
        .fetch_all(&db.pool)
        .await?,
        (Some(pid), false) => sqlx::query_as(
            "SELECT pa.id, pa.asset_id, pa.condition, pa.threshold, pa.currency,
                    pa.active, pa.triggered_at, pa.created_at
             FROM price_alerts pa
             JOIN assets a ON a.id = pa.asset_id
             WHERE a.portfolio_id = ?
             ORDER BY pa.created_at DESC",
        )
        .bind(pid)
        .fetch_all(&db.pool)
        .await?,
        (None, true) => sqlx::query_as(
            "SELECT id, asset_id, condition, threshold, currency, active, triggered_at, created_at
             FROM price_alerts WHERE active = 1 ORDER BY created_at DESC",
        )
        .fetch_all(&db.pool)
        .await?,
        (None, false) => sqlx::query_as(
            "SELECT id, asset_id, condition, threshold, currency, active, triggered_at, created_at
             FROM price_alerts ORDER BY created_at DESC",
        )
        .fetch_all(&db.pool)
        .await?,
    };
    Ok(rows)
}

#[tauri::command]
pub async fn update_alert(
    db: State<'_, Db>,
    id: i64,
    condition: String,
    threshold: f64,
    currency: String,
    active: Option<bool>,
) -> AppResult<PriceAlert> {
    if !VALID_CONDITIONS.contains(&condition.as_str()) {
        return Err(AppError::validation("Koşul 'above' ya da 'below' olmalı"));
    }
    if threshold <= 0.0 {
        return Err(AppError::validation("Eşik değeri 0'dan büyük olmalı"));
    }
    // active=true ise triggered_at NULL'a sıfırla; pasif yapılırsa korunur
    let active_int: i64 = match active {
        Some(true) => 1,
        Some(false) => 0,
        None => 1, // edit'te varsayılan: yeniden aktif et
    };
    let row: PriceAlert = sqlx::query_as(
        "UPDATE price_alerts
         SET condition = ?, threshold = ?, currency = ?, active = ?,
             triggered_at = CASE WHEN ? = 1 THEN NULL ELSE triggered_at END
         WHERE id = ?
         RETURNING id, asset_id, condition, threshold, currency, active, triggered_at, created_at",
    )
    .bind(&condition)
    .bind(threshold)
    .bind(currency.to_uppercase())
    .bind(active_int)
    .bind(active_int)
    .bind(id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Alarm bulunamadı: id={id}")))?;
    Ok(row)
}

#[tauri::command]
pub async fn delete_alert(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM price_alerts WHERE id = ?")
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Alarm bulunamadı: id={id}")));
    }
    Ok(())
}

/// Tetiklenen alarm — UI rozetlerinde + bildirim mesajında kullanılır.
#[derive(Debug, Clone, Serialize)]
pub struct TriggeredAlert {
    pub alert_id: i64,
    pub asset_symbol: String,
    pub asset_name: String,
    pub condition: String,
    pub threshold: f64,
    pub current_price: f64,
    pub currency: String,
}

/// Aktif alarmları cache fiyatlarına karşı kontrol et, eşik geçenleri döner
/// ve `triggered_at`+`active=0` ile DB'de işaretler. Background loop ve
/// frontend rozet kontrolü bu komutu kullanır.
pub async fn check_alerts_inner(pool: &SqlitePool) -> AppResult<Vec<TriggeredAlert>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: i64,
        condition: String,
        threshold: f64,
        currency: String,
        symbol: String,
        name: String,
        cache_price: Option<f64>,
        cache_currency: Option<String>,
    }

    let rows: Vec<Row> = sqlx::query_as(
        "SELECT pa.id, pa.condition, pa.threshold, pa.currency,
                a.symbol, a.name,
                pc.price as cache_price, pc.currency as cache_currency
         FROM price_alerts pa
         JOIN assets a ON a.id = pa.asset_id
         LEFT JOIN price_cache pc ON pc.asset_id = pa.asset_id
         WHERE pa.active = 1",
    )
    .fetch_all(pool)
    .await?;

    let mut triggered = Vec::new();
    let now = now_secs();
    // FX rates lazy fetch — sadece ihtiyaç olunca
    let mut fx: Option<tcmb::FxRates> = None;

    for r in rows {
        // Cache yoksa atla — fiyat henüz çekilmemiş
        let Some(price) = r.cache_price else {
            continue;
        };
        let cache_cur = r.cache_currency.as_deref().unwrap_or("");

        // Alarm currency'sine göre fiyatı normalize et — FX gerekirse fetch
        let normalized_price = if cache_cur.eq_ignore_ascii_case(&r.currency) {
            price
        } else {
            if fx.is_none() {
                fx = match crate::services::fx::fetch_rates().await {
                    Ok(f) => Some(f),
                    Err(e) => {
                        log::warn!("[birik] alarm fx fetch failed: {e}");
                        continue; // FX yoksa bu alarmı bu tick'te atla
                    }
                };
            }
            let bridge = |c: &str| -> Option<f64> {
                if c.eq_ignore_ascii_case("TRY") {
                    Some(1.0)
                } else {
                    fx.as_ref().and_then(|f| f.rates.get(&c.to_uppercase()).copied())
                }
            };
            let from_rate = bridge(cache_cur);
            let to_rate = bridge(&r.currency);
            match (from_rate, to_rate) {
                (Some(f), Some(t)) if t > 0.0 => price * f / t,
                _ => continue, // çevrim mümkün değil
            }
        };

        let hit = match r.condition.as_str() {
            "above" => normalized_price >= r.threshold,
            "below" => normalized_price <= r.threshold,
            _ => false,
        };
        if !hit {
            continue;
        }

        sqlx::query("UPDATE price_alerts SET active = 0, triggered_at = ? WHERE id = ?")
            .bind(now)
            .bind(r.id)
            .execute(pool)
            .await?;

        triggered.push(TriggeredAlert {
            alert_id: r.id,
            asset_symbol: r.symbol,
            asset_name: r.name,
            condition: r.condition,
            threshold: r.threshold,
            current_price: normalized_price,
            currency: r.currency,
        });
    }

    Ok(triggered)
}

#[tauri::command]
pub async fn check_alerts(db: State<'_, Db>) -> AppResult<Vec<TriggeredAlert>> {
    check_alerts_inner(&db.pool).await
}
