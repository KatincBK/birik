use tauri::State;

use crate::db::models::Setting;
use crate::error::AppResult;
use crate::services::Db;

/// Pool ile direkt çalışan helper — komutlar arası get_setting çağırırken
/// State'siz kullanılır.
pub async fn get_setting_value(
    pool: &sqlx::SqlitePool,
    key: &str,
) -> AppResult<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|t| t.0))
}

#[tauri::command]
pub async fn get_setting(db: State<'_, Db>, key: String) -> AppResult<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(&key)
        .fetch_optional(&db.pool)
        .await?;
    Ok(row.map(|t| t.0))
}

#[tauri::command]
pub async fn set_setting(db: State<'_, Db>, key: String, value: String) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(&key)
    .bind(&value)
    .execute(&db.pool)
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn list_settings(db: State<'_, Db>) -> AppResult<Vec<Setting>> {
    let rows: Vec<Setting> = sqlx::query_as("SELECT key, value FROM settings ORDER BY key")
        .fetch_all(&db.pool)
        .await?;
    Ok(rows)
}
