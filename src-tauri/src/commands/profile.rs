use tauri::State;

use crate::commands::now_secs;
use crate::db::models::Profile;
use crate::error::{AppError, AppResult};
use crate::services::Db;

#[tauri::command]
pub async fn create_profile(db: State<'_, Db>, name: String) -> AppResult<Profile> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("Profil adı boş olamaz"));
    }
    let p: Profile = sqlx::query_as(
        "INSERT INTO profiles (name, created_at) VALUES (?, ?)
         RETURNING id, name, pinned, created_at",
    )
    .bind(trimmed)
    .bind(now_secs())
    .fetch_one(&db.pool)
    .await?;
    Ok(p)
}

#[tauri::command]
pub async fn list_profiles(db: State<'_, Db>) -> AppResult<Vec<Profile>> {
    let rows: Vec<Profile> = sqlx::query_as(
        "SELECT id, name, pinned, created_at FROM profiles ORDER BY pinned DESC, id ASC",
    )
    .fetch_all(&db.pool)
    .await?;
    Ok(rows)
}

#[tauri::command]
pub async fn rename_profile(db: State<'_, Db>, id: i64, name: String) -> AppResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("Profil adı boş olamaz"));
    }
    let res = sqlx::query("UPDATE profiles SET name = ? WHERE id = ?")
        .bind(trimmed)
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Profil bulunamadı: id={id}")));
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_profile(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles")
        .fetch_one(&db.pool)
        .await?;
    if count <= 1 {
        return Err(AppError::validation(
            "Son profil silinemez. En az bir profil kalmalı.",
        ));
    }
    // Manuel cascade — SQLite ALTER TABLE FK kısıtı nedeniyle DDL'de
    // ON DELETE CASCADE kuramadık. Bu profilin portföyleri silinince
    // portfolios üzerindeki FK'ler asset/transaction/cache/alert'i CASCADE eder.
    let mut tx = db.pool.begin().await?;
    sqlx::query("DELETE FROM budgets WHERE profile_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM portfolios WHERE profile_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let res = sqlx::query("DELETE FROM profiles WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Profil bulunamadı: id={id}")));
    }
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn set_profile_pin(
    db: State<'_, Db>,
    id: i64,
    pinned: bool,
) -> AppResult<()> {
    let res = sqlx::query("UPDATE profiles SET pinned = ? WHERE id = ?")
        .bind(if pinned { 1_i64 } else { 0 })
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Profil bulunamadı: id={id}")));
    }
    Ok(())
}
