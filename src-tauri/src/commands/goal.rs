use serde::Serialize;
use tauri::State;

use crate::commands::now_secs;
use crate::db::models::Goal;
use crate::error::{AppError, AppResult};
use crate::services::Db;

#[tauri::command]
pub async fn create_goal(
    db: State<'_, Db>,
    name: String,
    target_value: f64,
    currency: String,
    target_date: Option<i64>,
) -> AppResult<Goal> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("Hedef adı boş olamaz"));
    }
    if target_value <= 0.0 {
        return Err(AppError::validation("Hedef değeri 0'dan büyük olmalı"));
    }
    let row: Goal = sqlx::query_as(
        "INSERT INTO goals (name, target_value, currency, target_date, achieved_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)
         RETURNING id, name, target_value, currency, target_date, achieved_at, created_at",
    )
    .bind(trimmed)
    .bind(target_value)
    .bind(currency.to_uppercase())
    .bind(target_date)
    .bind(now_secs())
    .fetch_one(&db.pool)
    .await?;
    Ok(row)
}

#[tauri::command]
pub async fn list_goals(db: State<'_, Db>) -> AppResult<Vec<Goal>> {
    let rows: Vec<Goal> = sqlx::query_as(
        "SELECT id, name, target_value, currency, target_date, achieved_at, created_at
         FROM goals ORDER BY created_at DESC",
    )
    .fetch_all(&db.pool)
    .await?;
    Ok(rows)
}

#[derive(Debug, Clone, Serialize)]
pub struct GoalCheckResult {
    pub goal_id: i64,
    pub achieved: bool,
    pub current_value: f64,
    pub target_value: f64,
    pub progress: f64, // 0.0 - 1.0+ (1.0+ ulaşıldı)
}

/// Faz 6'da progress + celebration için kullanılacak. Şimdilik sadece raw kontrol.
/// Gerçek "current value" hesaplaması calculate_portfolio'dan gelecek.
#[tauri::command]
pub async fn check_goal_achievement(
    db: State<'_, Db>,
    goal_id: i64,
    current_value: f64,
) -> AppResult<GoalCheckResult> {
    let goal: Goal = sqlx::query_as(
        "SELECT id, name, target_value, currency, target_date, achieved_at, created_at
         FROM goals WHERE id = ?",
    )
    .bind(goal_id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Hedef bulunamadı: id={goal_id}")))?;

    let achieved = current_value >= goal.target_value;
    let progress = if goal.target_value > 0.0 {
        current_value / goal.target_value
    } else {
        0.0
    };

    if achieved && goal.achieved_at.is_none() {
        sqlx::query("UPDATE goals SET achieved_at = ? WHERE id = ?")
            .bind(now_secs())
            .bind(goal_id)
            .execute(&db.pool)
            .await?;
    }

    Ok(GoalCheckResult {
        goal_id,
        achieved,
        current_value,
        target_value: goal.target_value,
        progress,
    })
}
