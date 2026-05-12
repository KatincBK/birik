//! Aylık yatırım/birikim girişleri — bütçeden bağımsız.
//!
//! Kullanıcı her ay portföye koyduğu parayı manuel girer. Multi-currency:
//! mart ayında hem 5000 TRY hem 100 USD yatırım yapabilir → iki ayrı kayıt.
//! fx_to_usd ay ortası tarihinde Frankfurter historical ile kilitlenir
//! (bütçe entry pattern'inin aynısı).

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use tauri::State;

use crate::commands::now_secs;
use crate::error::{AppError, AppResult};
use crate::services::Db;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct InvestmentEntry {
    pub profile_id: i64,
    pub year_month: String,
    pub currency: String,
    pub amount: f64,
    pub fx_to_usd: Option<f64>,
    pub note: Option<String>,
    pub recorded_at: i64,
}

const ENTRY_COLS: &str =
    "profile_id, year_month, currency, amount, fx_to_usd, note, recorded_at";

fn ym_to_mid_iso(year_month: &str) -> Option<String> {
    let parts: Vec<&str> = year_month.split('-').collect();
    if parts.len() != 2 {
        return None;
    }
    let y: i32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    if !(1..=12).contains(&m) {
        return None;
    }
    Some(format!("{y:04}-{m:02}-15"))
}

#[tauri::command]
pub async fn upsert_investment_entry(
    db: State<'_, Db>,
    profile_id: i64,
    year_month: String,
    currency: String,
    amount: f64,
    note: Option<String>,
) -> AppResult<InvestmentEntry> {
    let ccy = currency.trim().to_uppercase();
    if ccy.is_empty() {
        return Err(AppError::validation("Para birimi boş olamaz"));
    }
    // Negatif tutar kabul: bazı aylar net yatırım yerine cüzdandan yenmiş
    // olabilir (geri çekim / portföyden tüketim).

    let fx_to_usd: Option<f64> = match ym_to_mid_iso(&year_month) {
        Some(date_iso) => {
            match crate::services::frankfurter::fetch_to_usd_at(&date_iso, &ccy).await {
                Ok(v) if v > 0.0 => Some(v),
                Ok(_) => None,
                Err(e) => {
                    log::warn!(
                        "[birik] investment fx lock fail (date={date_iso}, ccy={ccy}): {e}"
                    );
                    None
                }
            }
        }
        None => None,
    };

    let row: InvestmentEntry = sqlx::query_as(&format!(
        "INSERT INTO investment_entries
            (profile_id, year_month, currency, amount, fx_to_usd, note, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id, year_month, currency) DO UPDATE SET
            amount = excluded.amount,
            fx_to_usd = excluded.fx_to_usd,
            note = excluded.note,
            recorded_at = excluded.recorded_at
         RETURNING {ENTRY_COLS}"
    ))
    .bind(profile_id)
    .bind(&year_month)
    .bind(&ccy)
    .bind(amount)
    .bind(fx_to_usd)
    .bind(&note)
    .bind(now_secs())
    .fetch_one(&db.pool)
    .await?;
    Ok(row)
}

#[tauri::command]
pub async fn list_investment_entries(
    db: State<'_, Db>,
    profile_id: i64,
) -> AppResult<Vec<InvestmentEntry>> {
    let rows: Vec<InvestmentEntry> = sqlx::query_as(&format!(
        "SELECT {ENTRY_COLS} FROM investment_entries
         WHERE profile_id = ?
         ORDER BY year_month DESC, currency ASC"
    ))
    .bind(profile_id)
    .fetch_all(&db.pool)
    .await?;
    Ok(rows)
}

#[tauri::command]
pub async fn delete_investment_entry(
    db: State<'_, Db>,
    profile_id: i64,
    year_month: String,
    currency: String,
) -> AppResult<()> {
    sqlx::query(
        "DELETE FROM investment_entries
         WHERE profile_id = ? AND year_month = ? AND currency = ?",
    )
    .bind(profile_id)
    .bind(year_month)
    .bind(currency.to_uppercase())
    .execute(&db.pool)
    .await?;
    Ok(())
}
