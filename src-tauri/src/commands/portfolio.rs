use tauri::State;

use crate::commands::now_secs;
use crate::db::models::Portfolio;
use crate::error::{AppError, AppResult};
use crate::services::Db;

#[tauri::command]
pub async fn create_portfolio(
    db: State<'_, Db>,
    name: String,
    profile_id: i64,
) -> AppResult<Portfolio> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("Portföy adı boş olamaz"));
    }
    let now = now_secs();
    let row: Portfolio = sqlx::query_as(
        "INSERT INTO portfolios (name, created_at, pinned, profile_id) VALUES (?, ?, 0, ?)
         RETURNING id, name, created_at, pinned, profile_id",
    )
    .bind(trimmed)
    .bind(now)
    .bind(profile_id)
    .fetch_one(&db.pool)
    .await?;
    Ok(row)
}

/// Profil'e göre filtre. None ise tümü (eski "Hepsi" sıralı dökümleri için).
#[tauri::command]
pub async fn list_portfolios(
    db: State<'_, Db>,
    profile_id: Option<i64>,
) -> AppResult<Vec<Portfolio>> {
    let rows: Vec<Portfolio> = match profile_id {
        Some(pid) => sqlx::query_as(
            "SELECT id, name, created_at, pinned, profile_id FROM portfolios
             WHERE profile_id = ?
             ORDER BY pinned DESC, id ASC",
        )
        .bind(pid)
        .fetch_all(&db.pool)
        .await?,
        None => sqlx::query_as(
            "SELECT id, name, created_at, pinned, profile_id FROM portfolios
             ORDER BY pinned DESC, id ASC",
        )
        .fetch_all(&db.pool)
        .await?,
    };
    Ok(rows)
}

#[tauri::command]
pub async fn delete_portfolio(db: State<'_, Db>, id: i64) -> AppResult<()> {
    // Aynı profilde son portföyse silmeye izin verme
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT profile_id FROM portfolios WHERE id = ?")
            .bind(id)
            .fetch_optional(&db.pool)
            .await?;
    let pid = match row {
        Some((p,)) => p,
        None => return Err(AppError::not_found(format!("Portföy bulunamadı: id={id}"))),
    };

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM portfolios WHERE profile_id = ?")
            .bind(pid)
            .fetch_one(&db.pool)
            .await?;
    if count <= 1 {
        return Err(AppError::validation(
            "Bu profilin son portföyü. En az bir portföy kalmalı.",
        ));
    }

    sqlx::query("DELETE FROM portfolios WHERE id = ?")
        .bind(id)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn set_portfolio_pin(
    db: State<'_, Db>,
    id: i64,
    pinned: bool,
) -> AppResult<()> {
    let res = sqlx::query("UPDATE portfolios SET pinned = ? WHERE id = ?")
        .bind(if pinned { 1_i64 } else { 0 })
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Portföy bulunamadı: id={id}")));
    }
    Ok(())
}

#[tauri::command]
pub async fn rename_portfolio(
    db: State<'_, Db>,
    id: i64,
    name: String,
) -> AppResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("Portföy adı boş olamaz"));
    }
    let res = sqlx::query("UPDATE portfolios SET name = ? WHERE id = ?")
        .bind(trimmed)
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Portföy bulunamadı: id={id}")));
    }
    Ok(())
}
