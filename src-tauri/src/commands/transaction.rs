use sqlx::SqlitePool;
use tauri::State;

use crate::commands::now_secs;
use crate::db::models::Transaction;
use crate::error::{AppError, AppResult};
use crate::services::Db;

/// transaction.date (unix sec) ve asset.currency için tarihsel USD kur lock.
/// Hata olursa None — display tarafı current FX ile fallback.
async fn lock_fx_to_usd(pool: &SqlitePool, asset_id: i64, date: i64) -> Option<f64> {
    let asset_ccy: Option<(String,)> =
        sqlx::query_as("SELECT currency FROM assets WHERE id = ?")
            .bind(asset_id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    let ccy = asset_ccy?.0.to_uppercase();
    if ccy == "USD" {
        return Some(1.0);
    }
    let dt = chrono::DateTime::<chrono::Utc>::from_timestamp(date, 0)?;
    let date_iso = dt.format("%Y-%m-%d").to_string();
    match crate::services::frankfurter::fetch_to_usd_at(&date_iso, &ccy).await {
        Ok(v) if v > 0.0 => Some(v),
        Ok(_) => None,
        Err(e) => {
            log::warn!(
                "[birik] tx fx lock fail (asset={asset_id}, date={date_iso}, ccy={ccy}): {e}"
            );
            None
        }
    }
}

const VALID_TYPES: &[&str] = &["buy", "sell", "passive_income"];
const VALID_SOURCES: &[&str] = &["staking", "dividend", "interest"];

/// PLAN §11 edge case'leri burada uygulanıyor:
/// - tarih bugünden ileri olamaz
/// - miktar > 0
/// - alış/satış için fiyat > 0 (passive_income için 0 olabilir)
fn validate(
    tx_type: &str,
    source: Option<&str>,
    quantity: f64,
    price: f64,
    date: i64,
) -> AppResult<()> {
    if !VALID_TYPES.contains(&tx_type) {
        return Err(AppError::validation(format!("Geçersiz işlem tipi: {tx_type}")));
    }
    if tx_type == "passive_income" {
        match source {
            Some(s) if VALID_SOURCES.contains(&s) => {}
            _ => {
                return Err(AppError::validation(
                    "Pasif gelir için kaynak belirtilmeli (staking/dividend/interest)",
                ))
            }
        }
    }
    if quantity <= 0.0 {
        return Err(AppError::validation("Miktar 0'dan büyük olmalı"));
    }
    if (tx_type == "buy" || tx_type == "sell") && price <= 0.0 {
        return Err(AppError::validation("Fiyat 0'dan büyük olmalı"));
    }
    if price < 0.0 {
        return Err(AppError::validation("Fiyat negatif olamaz"));
    }
    let now = now_secs();
    if date > now + 60 {
        return Err(AppError::validation("Gelecek tarihli işlem girilemez"));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_transaction(
    db: State<'_, Db>,
    asset_id: i64,
    date: i64,
    #[allow(non_snake_case)] r#type: String,
    source: Option<String>,
    quantity: f64,
    price: f64,
    fee: Option<f64>,
    note: Option<String>,
    tags: Option<Vec<String>>,
    platform: Option<String>,
) -> AppResult<Transaction> {
    validate(&r#type, source.as_deref(), quantity, price, date)?;
    let fee = fee.unwrap_or(0.0);
    let platform_clean = platform
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let fx_to_usd = lock_fx_to_usd(&db.pool, asset_id, date).await;

    let mut tx = db.pool.begin().await?;

    let row: Transaction = sqlx::query_as(
        "INSERT INTO transactions
            (asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
         RETURNING id, asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform",
    )
    .bind(asset_id)
    .bind(date)
    .bind(&r#type)
    .bind(&source)
    .bind(quantity)
    .bind(price)
    .bind(fee)
    .bind(&note)
    .bind(now_secs())
    .bind(fx_to_usd)
    .bind(&platform_clean)
    .fetch_one(&mut *tx)
    .await?;

    if let Some(tag_list) = tags {
        for raw in tag_list {
            let tag = raw.trim();
            if tag.is_empty() {
                continue;
            }
            // PLAN §11: aynı etiket tekrar → sessizce ignore (PRIMARY KEY unique)
            sqlx::query(
                "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag) VALUES (?, ?)",
            )
            .bind(row.id)
            .bind(tag)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    Ok(row)
}

#[tauri::command]
pub async fn list_transactions(
    db: State<'_, Db>,
    asset_id: i64,
    include_deleted: Option<bool>,
    tag: Option<String>,
) -> AppResult<Vec<Transaction>> {
    let include_deleted = include_deleted.unwrap_or(false);
    let tag = tag.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());

    let rows: Vec<Transaction> = match (include_deleted, tag) {
        (true, None) => {
            sqlx::query_as(
                "SELECT id, asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform
                 FROM transactions WHERE asset_id = ? ORDER BY date DESC, id DESC",
            )
            .bind(asset_id)
            .fetch_all(&db.pool)
            .await?
        }
        (false, None) => {
            sqlx::query_as(
                "SELECT id, asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform
                 FROM transactions WHERE asset_id = ? AND is_deleted = 0 ORDER BY date DESC, id DESC",
            )
            .bind(asset_id)
            .fetch_all(&db.pool)
            .await?
        }
        (true, Some(t)) => {
            sqlx::query_as(
                "SELECT t.id, t.asset_id, t.date, t.type, t.source, t.quantity, t.price, t.fee, t.note, t.is_deleted, t.created_at, t.fx_to_usd, t.platform
                 FROM transactions t
                 INNER JOIN transaction_tags tt ON tt.transaction_id = t.id
                 WHERE t.asset_id = ? AND tt.tag = ?
                 ORDER BY t.date DESC, t.id DESC",
            )
            .bind(asset_id)
            .bind(t)
            .fetch_all(&db.pool)
            .await?
        }
        (false, Some(t)) => {
            sqlx::query_as(
                "SELECT t.id, t.asset_id, t.date, t.type, t.source, t.quantity, t.price, t.fee, t.note, t.is_deleted, t.created_at, t.fx_to_usd, t.platform
                 FROM transactions t
                 INNER JOIN transaction_tags tt ON tt.transaction_id = t.id
                 WHERE t.asset_id = ? AND t.is_deleted = 0 AND tt.tag = ?
                 ORDER BY t.date DESC, t.id DESC",
            )
            .bind(asset_id)
            .bind(t)
            .fetch_all(&db.pool)
            .await?
        }
    };
    Ok(rows)
}

#[tauri::command]
pub async fn list_transaction_tags(
    db: State<'_, Db>,
    asset_id: i64,
) -> AppResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT tt.tag
         FROM transaction_tags tt
         INNER JOIN transactions t ON t.id = tt.transaction_id
         WHERE t.asset_id = ? AND t.is_deleted = 0
         ORDER BY tt.tag",
    )
    .bind(asset_id)
    .fetch_all(&db.pool)
    .await?;
    Ok(rows.into_iter().map(|t| t.0).collect())
}

/// 5sn undo penceresi için. Gerçek silme `hard_delete_transaction` ile.
#[tauri::command]
pub async fn soft_delete_transaction(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let res = sqlx::query("UPDATE transactions SET is_deleted = 1 WHERE id = ?")
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!(
            "İşlem bulunamadı: id={id}"
        )));
    }
    Ok(())
}

#[tauri::command]
pub async fn hard_delete_transaction(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM transactions WHERE id = ?")
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!(
            "İşlem bulunamadı: id={id}"
        )));
    }
    Ok(())
}

/// Mevcut işlemi düzenle. Tip ve asset değişmez (asset taşıma destek yok).
/// Tags param verilirse mevcut etiketler komple silinip yenisi yazılır.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn update_transaction(
    db: State<'_, Db>,
    id: i64,
    date: i64,
    quantity: f64,
    price: f64,
    fee: Option<f64>,
    note: Option<String>,
    tags: Option<Vec<String>>,
    platform: Option<String>,
) -> AppResult<Transaction> {
    // Mevcut tx'i bul (tip kontrolü için)
    let existing: Transaction = sqlx::query_as(
        "SELECT id, asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform
         FROM transactions WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| AppError::not_found(format!("İşlem bulunamadı: id={id}")))?;

    // Tip-bağımlı validation (mevcut tipiyle)
    validate(
        &existing.tx_type,
        existing.source.as_deref(),
        quantity,
        price,
        date,
    )?;
    let fee = fee.unwrap_or(0.0);

    // Tarih değişmişse fx_to_usd yeniden hesapla, değişmemişse mevcut kalsın.
    let fx_to_usd = if date != existing.date {
        lock_fx_to_usd(&db.pool, existing.asset_id, date).await
    } else {
        existing.fx_to_usd
    };

    let mut tx = db.pool.begin().await?;

    let platform_clean = platform
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let updated: Transaction = sqlx::query_as(
        "UPDATE transactions
         SET date = ?, quantity = ?, price = ?, fee = ?, note = ?, fx_to_usd = ?, platform = ?
         WHERE id = ?
         RETURNING id, asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform",
    )
    .bind(date)
    .bind(quantity)
    .bind(price)
    .bind(fee)
    .bind(&note)
    .bind(fx_to_usd)
    .bind(&platform_clean)
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;

    if let Some(tag_list) = tags {
        sqlx::query("DELETE FROM transaction_tags WHERE transaction_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        for raw in tag_list {
            let tag = raw.trim();
            if tag.is_empty() {
                continue;
            }
            sqlx::query(
                "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag) VALUES (?, ?)",
            )
            .bind(id)
            .bind(tag)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    Ok(updated)
}

/// Bir işlemin etiketlerini liste olarak getir (edit modal'ın doldurması için).
#[tauri::command]
pub async fn list_tags_of_transaction(
    db: State<'_, Db>,
    transaction_id: i64,
) -> AppResult<Vec<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT tag FROM transaction_tags WHERE transaction_id = ? ORDER BY tag")
            .bind(transaction_id)
            .fetch_all(&db.pool)
            .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

#[tauri::command]
pub async fn restore_transaction(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let res = sqlx::query("UPDATE transactions SET is_deleted = 0 WHERE id = ?")
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!(
            "İşlem bulunamadı: id={id}"
        )));
    }
    Ok(())
}
