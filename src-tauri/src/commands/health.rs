use serde::Serialize;
use tauri::State;

use crate::error::AppResult;
use crate::services::Db;

#[derive(Debug, Serialize)]
pub struct HealthInfo {
    pub schema_version: i64,
    pub portfolios: i64,
    pub settings: i64,
}

/// Boot doğrulaması — frontend ilk açılışta çağırır, DB hazır mı diye.
#[tauri::command]
pub async fn db_health_check(db: State<'_, Db>) -> AppResult<HealthInfo> {
    let schema_version: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations WHERE success = 1",
    )
    .fetch_one(&db.pool)
    .await?;

    let portfolios: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM portfolios")
        .fetch_one(&db.pool)
        .await?;

    let settings: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings")
        .fetch_one(&db.pool)
        .await?;

    Ok(HealthInfo {
        schema_version,
        portfolios,
        settings,
    })
}
