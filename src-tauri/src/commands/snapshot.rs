use serde::Serialize;
use tauri::State;

use crate::error::AppResult;
use crate::services::Db;

#[derive(Debug, Clone, Serialize)]
pub struct PaceEstimate {
    /// Son N günde günlük ortalama büyüme (display currency).
    pub avg_daily_growth: f64,
    /// Hedefe ulaşmak için kalan tahmini gün. Tempo ≤ 0 ise None.
    pub days_to_goal: Option<i64>,
    /// Hangi periyod tarandı (gün)
    pub days_window: i64,
    /// Window içinde kaç snapshot bulundu
    pub samples: i64,
}

/// Son `days` (default 30) gün için snapshot'ları kullanarak ETA hesabı.
/// Basit lineer büyüme: (latest - earliest) / (gün_farkı). Negatif veya 0 büyümede None.
///
/// Hedef değer ile şimdiki değer arasındaki fark / günlük büyüme = kalan gün.
#[tauri::command]
pub async fn estimate_goal_pace(
    db: State<'_, Db>,
    portfolio_id: Option<i64>, // None = tüm portföylerin toplamı
    currency: String,
    target_value: f64,
    current_value: f64,
    days: Option<i64>,
) -> AppResult<PaceEstimate> {
    let days = days.unwrap_or(30);
    let from_date =
        (chrono::Utc::now() - chrono::Duration::days(days)).format("%Y-%m-%d").to_string();

    #[derive(sqlx::FromRow)]
    struct Snap {
        date: String,
        total_value: f64,
    }

    // Tüm portföylerin toplamı — frontend "Hepsi" görünümü için
    let snaps: Vec<Snap> = match portfolio_id {
        Some(pid) => {
            sqlx::query_as(
                "SELECT date, total_value FROM portfolio_snapshots
                 WHERE portfolio_id = ? AND currency = ? AND date >= ?
                 ORDER BY date ASC",
            )
            .bind(pid)
            .bind(&currency)
            .bind(&from_date)
            .fetch_all(&db.pool)
            .await?
        }
        None => {
            sqlx::query_as(
                "SELECT date, SUM(total_value) AS total_value
                 FROM portfolio_snapshots
                 WHERE currency = ? AND date >= ?
                 GROUP BY date
                 ORDER BY date ASC",
            )
            .bind(&currency)
            .bind(&from_date)
            .fetch_all(&db.pool)
            .await?
        }
    };

    if snaps.len() < 2 {
        return Ok(PaceEstimate {
            avg_daily_growth: 0.0,
            days_to_goal: None,
            days_window: days,
            samples: snaps.len() as i64,
        });
    }

    let first = &snaps[0];
    let last = &snaps[snaps.len() - 1];

    let parse = |s: &str| -> Option<chrono::NaiveDate> {
        chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
    };
    let (Some(d1), Some(d2)) = (parse(&first.date), parse(&last.date)) else {
        return Ok(PaceEstimate {
            avg_daily_growth: 0.0,
            days_to_goal: None,
            days_window: days,
            samples: snaps.len() as i64,
        });
    };
    let day_diff = (d2 - d1).num_days().max(1);
    let value_diff = last.total_value - first.total_value;
    let avg_daily_growth = value_diff / day_diff as f64;

    let remaining = target_value - current_value;
    let days_to_goal = if avg_daily_growth > 0.0 && remaining > 0.0 {
        Some((remaining / avg_daily_growth).ceil() as i64)
    } else {
        None
    };

    Ok(PaceEstimate {
        avg_daily_growth,
        days_to_goal,
        days_window: days,
        samples: snaps.len() as i64,
    })
}
