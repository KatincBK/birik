//! Fiyat cache helper'ları. PLAN §3: 5 dk TTL, varlık başına satır.
//! Cache wrapper'ları command layer'da bu fonksiyonları çağırıyor.

use sqlx::SqlitePool;

use crate::commands::now_secs;
use crate::db::models::PriceCache;
use crate::error::AppResult;

/// Default TTL — 5 dk (PLAN §3)
pub const TTL_SECS: i64 = 5 * 60;

pub async fn get(pool: &SqlitePool, asset_id: i64) -> AppResult<Option<PriceCache>> {
    let row: Option<PriceCache> = sqlx::query_as(
        "SELECT asset_id, price, currency, fetched_at, change_24h_pct
         FROM price_cache WHERE asset_id = ?",
    )
    .bind(asset_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Cache TTL içinde mi?
pub fn is_fresh(cache: &PriceCache) -> bool {
    now_secs() - cache.fetched_at < TTL_SECS
}

pub async fn put(
    pool: &SqlitePool,
    asset_id: i64,
    price: f64,
    currency: &str,
    change_24h_pct: Option<f64>,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO price_cache (asset_id, price, currency, fetched_at, change_24h_pct)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET
            price = excluded.price,
            currency = excluded.currency,
            fetched_at = excluded.fetched_at,
            change_24h_pct = excluded.change_24h_pct",
    )
    .bind(asset_id)
    .bind(price)
    .bind(currency)
    .bind(now_secs())
    .bind(change_24h_pct)
    .execute(pool)
    .await?;
    Ok(())
}
