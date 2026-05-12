use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

use crate::commands::now_secs;
use crate::db::models::{Budget, BudgetEntry};
use crate::error::{AppError, AppResult};
use crate::services::Db;

const DEFAULT_GROWTH_PCT: f64 = 8.0;

/// Settings'ten mode + custom değer okur, ETA hesabı için yıllık sermaye
/// büyüme oranı (%) döndürür. Mode'lar:
///   "auto"             → portfolio CAGR (cost-weighted), yoksa %8 fallback
///   "from_investments" → investment_entries cash-flow bazlı basit CAGR
///   "custom"           → kullanıcının custom_growth_pct_yearly değeri
async fn compute_growth_estimate(
    pool: &SqlitePool,
    profile_id: Option<i64>,
    current_portfolio_value: f64,
) -> Option<f64> {
    let mode: String = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key = 'growth_estimate_mode'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "auto".to_string());

    let custom_pct: f64 = sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key = 'custom_growth_pct_yearly'",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .and_then(|s| s.parse::<f64>().ok())
    .unwrap_or(DEFAULT_GROWTH_PCT);

    let Some(pid) = profile_id else {
        return Some(DEFAULT_GROWTH_PCT);
    };

    match mode.as_str() {
        "custom" => Some(custom_pct),
        "from_investments" => {
            compute_investment_based_cagr(pool, pid, current_portfolio_value)
                .await
                .or(Some(DEFAULT_GROWTH_PCT))
        }
        _ => {
            // "auto" — portfolio history CAGR varsa onu, yoksa default
            compute_portfolio_cagr(pool, pid)
                .await
                .or(Some(DEFAULT_GROWTH_PCT))
        }
    }
}

/// Cost-weighted holding period bazlı portfolio CAGR (% / yıl). 50 günden az
/// pozisyon → None. Profilin USD-base toplamı üzerinden hesap.
async fn compute_portfolio_cagr(pool: &SqlitePool, profile_id: i64) -> Option<f64> {
    let portfolios: Vec<crate::db::models::Portfolio> = sqlx::query_as(
        "SELECT id, name, created_at, pinned, profile_id FROM portfolios WHERE profile_id = ?",
    )
    .bind(profile_id)
    .fetch_all(pool)
    .await
    .ok()?;

    let mut total_value = 0.0;
    let mut total_invested = 0.0;
    let mut cost_weighted_years = 0.0;
    let mut total_cost_for_cagr = 0.0;

    for p in &portfolios {
        let s = match crate::commands::calc::calculate_portfolio_inner(pool, p.id, "USD").await {
            Ok(s) => s,
            Err(_) => continue,
        };
        total_value += s.total_value;
        total_invested += s.total_cost;
        for a in &s.assets {
            if a.total_cost_display <= 0.0 {
                continue;
            }
            let first_buy: Option<(Option<i64>,)> = sqlx::query_as(
                "SELECT MIN(date) FROM transactions
                 WHERE asset_id = ? AND type = 'buy' AND is_deleted = 0",
            )
            .bind(a.asset_id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
            if let Some((Some(d),)) = first_buy {
                let now = chrono::Utc::now().timestamp();
                let secs = (now - d).max(0);
                let years = secs as f64 / (365.25 * 24.0 * 3600.0);
                if years > 0.0 {
                    cost_weighted_years += a.total_cost_display * years;
                    total_cost_for_cagr += a.total_cost_display;
                }
            }
        }
    }
    if total_cost_for_cagr <= 0.0 || total_value <= 0.0 || total_invested <= 0.0 {
        return None;
    }
    let avg_years = cost_weighted_years / total_cost_for_cagr;
    if avg_years <= 0.05 {
        return None;
    }
    let ratio = total_value / total_invested;
    if ratio <= 0.0 {
        return None;
    }
    Some((ratio.powf(1.0 / avg_years) - 1.0) * 100.0)
}

/// investment_entries kayıtlarının USD-locked toplamı vs. current portfolio
/// üzerinden basit yıllıklaştırılmış return. Veri yoksa None.
async fn compute_investment_based_cagr(
    pool: &SqlitePool,
    profile_id: i64,
    current_portfolio_value: f64,
) -> Option<f64> {
    #[derive(sqlx::FromRow)]
    struct Row {
        year_month: String,
        amount: f64,
        fx_to_usd: Option<f64>,
        currency: String,
    }
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT year_month, amount, fx_to_usd, currency
         FROM investment_entries WHERE profile_id = ?",
    )
    .bind(profile_id)
    .fetch_all(pool)
    .await
    .ok()?;
    if rows.is_empty() {
        return None;
    }
    let mut total_usd = 0.0;
    let mut earliest_year_month: Option<String> = None;
    for r in &rows {
        let usd = if let Some(f) = r.fx_to_usd {
            r.amount * f
        } else if r.currency.eq_ignore_ascii_case("USD") {
            r.amount
        } else {
            continue;
        };
        total_usd += usd;
        match &earliest_year_month {
            None => earliest_year_month = Some(r.year_month.clone()),
            Some(e) if r.year_month < *e => earliest_year_month = Some(r.year_month.clone()),
            _ => {}
        }
    }
    if total_usd <= 0.0 {
        return None;
    }
    let earliest = earliest_year_month?;
    let parts: Vec<&str> = earliest.split('-').collect();
    if parts.len() != 2 {
        return None;
    }
    let y: i32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    let start_date = chrono::NaiveDate::from_ymd_opt(y, m, 15)?;
    let now = chrono::Utc::now().date_naive();
    let days = (now - start_date).num_days().max(1);
    let years = days as f64 / 365.25;
    if years <= 0.05 {
        return None;
    }
    let ratio = current_portfolio_value / total_usd;
    if ratio <= 0.0 {
        return None;
    }
    Some((ratio.powf(1.0 / years) - 1.0) * 100.0)
}

const BUDGET_COLS: &str = "id, name, monthly_income, monthly_expense, currency, \
    target_value, target_date, pinned, created_at, profile_id, target_currency";

const ENTRY_COLS: &str = "budget_id, year_month, income, expense, note, recorded_at, \
    currency, fx_to_usd";

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_budget(
    db: State<'_, Db>,
    profile_id: i64,
    name: String,
    monthly_income: f64,
    monthly_expense: f64,
    currency: String,
    target_value: Option<f64>,
    target_date: Option<i64>,
    target_currency: Option<String>,
) -> AppResult<Budget> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("Bütçe adı boş olamaz"));
    }
    if monthly_income < 0.0 || monthly_expense < 0.0 {
        return Err(AppError::validation("Gelir ve gider negatif olamaz"));
    }
    let existing: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM budgets WHERE profile_id = ?")
            .bind(profile_id)
            .fetch_optional(&db.pool)
            .await?;
    if existing.is_some() {
        return Err(AppError::validation(
            "Bu profilin zaten bir bütçesi var. Düzenle ya da sil.",
        ));
    }

    let row: Budget = sqlx::query_as(&format!(
        "INSERT INTO budgets
            (name, monthly_income, monthly_expense, currency, target_value, target_date,
             pinned, created_at, profile_id, target_currency)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
         RETURNING {BUDGET_COLS}"
    ))
    .bind(trimmed)
    .bind(monthly_income)
    .bind(monthly_expense)
    .bind(currency.to_uppercase())
    .bind(target_value)
    .bind(target_date)
    .bind(now_secs())
    .bind(profile_id)
    .bind(target_currency.map(|c| c.to_uppercase()))
    .fetch_one(&db.pool)
    .await?;
    Ok(row)
}

/// Profil filter — None: tümü; Some(pid): sadece o profilin bütçesi.
#[tauri::command]
pub async fn list_budgets(
    db: State<'_, Db>,
    profile_id: Option<i64>,
) -> AppResult<Vec<Budget>> {
    let rows: Vec<Budget> = match profile_id {
        Some(pid) => sqlx::query_as(&format!(
            "SELECT {BUDGET_COLS} FROM budgets WHERE profile_id = ? ORDER BY id ASC"
        ))
        .bind(pid)
        .fetch_all(&db.pool)
        .await?,
        None => sqlx::query_as(&format!(
            "SELECT {BUDGET_COLS} FROM budgets ORDER BY pinned DESC, id ASC"
        ))
        .fetch_all(&db.pool)
        .await?,
    };
    Ok(rows)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn update_budget(
    db: State<'_, Db>,
    id: i64,
    name: String,
    monthly_income: f64,
    monthly_expense: f64,
    currency: String,
    target_value: Option<f64>,
    target_date: Option<i64>,
    target_currency: Option<String>,
) -> AppResult<Budget> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("Bütçe adı boş olamaz"));
    }
    if monthly_income < 0.0 || monthly_expense < 0.0 {
        return Err(AppError::validation("Gelir ve gider negatif olamaz"));
    }
    let row: Budget = sqlx::query_as(&format!(
        "UPDATE budgets SET name = ?, monthly_income = ?, monthly_expense = ?,
                            currency = ?, target_value = ?, target_date = ?,
                            target_currency = ?
         WHERE id = ?
         RETURNING {BUDGET_COLS}"
    ))
    .bind(trimmed)
    .bind(monthly_income)
    .bind(monthly_expense)
    .bind(currency.to_uppercase())
    .bind(target_value)
    .bind(target_date)
    .bind(target_currency.map(|c| c.to_uppercase()))
    .bind(id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Bütçe bulunamadı: id={id}")))?;
    Ok(row)
}

#[tauri::command]
pub async fn delete_budget(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM budgets WHERE id = ?")
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Bütçe bulunamadı: id={id}")));
    }
    Ok(())
}

#[tauri::command]
pub async fn set_budget_pin(
    db: State<'_, Db>,
    id: i64,
    pinned: bool,
) -> AppResult<()> {
    let res = sqlx::query("UPDATE budgets SET pinned = ? WHERE id = ?")
        .bind(if pinned { 1_i64 } else { 0 })
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Bütçe bulunamadı: id={id}")));
    }
    Ok(())
}

/* ----------------------------------------------------------------
 * Aylık entries
 * ---------------------------------------------------------------- */

/// year_month "YYYY-MM" formatından o ayın 15'i tarihini ISO formatında döndür.
/// Frankfurter historical sorgusu için. Ay ortası seçildi (ay başı/sonu hafta
/// sonuna denk gelirse Frankfurter en yakın iş gününe yuvarlar; ay ortası daha
/// güvenli ve "ay genelinin" temsili).
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
pub async fn upsert_budget_entry(
    db: State<'_, Db>,
    budget_id: i64,
    year_month: String,
    income: f64,
    expense: f64,
    note: Option<String>,
    currency: Option<String>,
) -> AppResult<BudgetEntry> {
    // currency belirtilmediyse bütçenin defaultunu kullan
    let resolved_currency: String = match currency {
        Some(c) if !c.trim().is_empty() => c.trim().to_uppercase(),
        _ => {
            let row: Option<(String,)> =
                sqlx::query_as("SELECT currency FROM budgets WHERE id = ?")
                    .bind(budget_id)
                    .fetch_optional(&db.pool)
                    .await?;
            row.map(|(c,)| c.to_uppercase())
                .unwrap_or_else(|| "USD".to_string())
        }
    };

    // Tarihsel kur kilit — Frankfurter historical. Hata olursa NULL bırak
    // (display tarafı current FX ile fallback yapar).
    let fx_to_usd: Option<f64> = match ym_to_mid_iso(&year_month) {
        Some(date_iso) => match crate::services::frankfurter::fetch_to_usd_at(
            &date_iso,
            &resolved_currency,
        )
        .await
        {
            Ok(v) if v > 0.0 => Some(v),
            Ok(_) => None,
            Err(e) => {
                log::warn!(
                    "[birik] frankfurter historical fail (date={date_iso}, ccy={resolved_currency}): {e}"
                );
                None
            }
        },
        None => None,
    };

    let row: BudgetEntry = sqlx::query_as(&format!(
        "INSERT INTO budget_entries
            (budget_id, year_month, income, expense, note, recorded_at, currency, fx_to_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(budget_id, year_month) DO UPDATE SET
            income = excluded.income,
            expense = excluded.expense,
            note = excluded.note,
            recorded_at = excluded.recorded_at,
            currency = excluded.currency,
            fx_to_usd = excluded.fx_to_usd
         RETURNING {ENTRY_COLS}"
    ))
    .bind(budget_id)
    .bind(year_month)
    .bind(income)
    .bind(expense)
    .bind(&note)
    .bind(now_secs())
    .bind(&resolved_currency)
    .bind(fx_to_usd)
    .fetch_one(&db.pool)
    .await?;
    Ok(row)
}

#[tauri::command]
pub async fn list_budget_entries(
    db: State<'_, Db>,
    budget_id: i64,
) -> AppResult<Vec<BudgetEntry>> {
    let rows: Vec<BudgetEntry> = sqlx::query_as(&format!(
        "SELECT {ENTRY_COLS} FROM budget_entries
         WHERE budget_id = ?
         ORDER BY year_month DESC"
    ))
    .bind(budget_id)
    .fetch_all(&db.pool)
    .await?;
    Ok(rows)
}

#[tauri::command]
pub async fn delete_budget_entry(
    db: State<'_, Db>,
    budget_id: i64,
    year_month: String,
) -> AppResult<()> {
    sqlx::query(
        "DELETE FROM budget_entries WHERE budget_id = ? AND year_month = ?",
    )
    .bind(budget_id)
    .bind(year_month)
    .execute(&db.pool)
    .await?;
    Ok(())
}

/* ----------------------------------------------------------------
 * Projeksyon
 * ---------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize)]
pub struct BudgetProjection {
    pub budget_id: i64,
    pub currency: String,
    pub monthly_savings: f64,
    pub current_portfolio_value: f64,
    pub monthly_passive_income: f64,
    pub months_to_target: Option<i64>,
    pub trajectory: Vec<(i64, f64)>,
}

#[tauri::command]
pub async fn project_budget(
    db: State<'_, Db>,
    budget_id: i64,
) -> AppResult<BudgetProjection> {
    let budget: Budget = sqlx::query_as(&format!(
        "SELECT {BUDGET_COLS} FROM budgets WHERE id = ?"
    ))
    .bind(budget_id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Bütçe bulunamadı: id={budget_id}")))?;

    let currency = budget.currency.clone();
    let monthly_savings = (budget.monthly_income - budget.monthly_expense).max(0.0);

    // Portföy değeri budget currency'sinde
    let portfolios: Vec<crate::db::models::Portfolio> = match budget.profile_id {
        Some(pid) => sqlx::query_as(
            "SELECT id, name, created_at, pinned, profile_id FROM portfolios WHERE profile_id = ?",
        )
        .bind(pid)
        .fetch_all(&db.pool)
        .await?,
        None => sqlx::query_as("SELECT id, name, created_at, pinned, profile_id FROM portfolios")
            .fetch_all(&db.pool)
            .await?,
    };
    let mut current_portfolio_value = 0.0;
    let mut weighted_yield_sum = 0.0;
    let mut weighted_yield_total = 0.0;
    for p in portfolios {
        let s = super::calc::calculate_portfolio_inner(&db.pool, p.id, &currency).await?;
        current_portfolio_value += s.total_value;
        for a in s.assets {
            if let (Some(mv), Some(y)) = (a.market_value_display, a.expected_yield_pct) {
                weighted_yield_sum += mv * y / 100.0;
                weighted_yield_total += mv;
            }
        }
    }
    let monthly_passive_income = if weighted_yield_total > 0.0 {
        weighted_yield_sum / 12.0
    } else {
        0.0
    };

    let avg_yearly_yield_pct = if weighted_yield_total > 0.0 {
        weighted_yield_sum / weighted_yield_total * 100.0
    } else {
        0.0
    };

    // Sermaye büyüme tahmini — settings'ten mode oku
    let growth_pct =
        compute_growth_estimate(&db.pool, budget.profile_id, current_portfolio_value)
            .await
            .unwrap_or(8.0);

    // Toplam yıllık büyüme = sermaye + pasif gelir (kullanıcının seçimi)
    let total_yearly_pct = growth_pct + avg_yearly_yield_pct;
    let monthly_yield_rate = total_yearly_pct / 100.0 / 12.0;
    let monthly_addition = monthly_savings;

    let mut trajectory = Vec::with_capacity(13);
    let mut v = current_portfolio_value;
    trajectory.push((0, v));
    for m in 1..=12 {
        v = v * (1.0 + monthly_yield_rate) + monthly_addition;
        trajectory.push((m, v));
    }

    // target — target_currency varsa budget currency'ye convert et (current FX)
    let target_in_budget_ccy: Option<f64> = match (budget.target_value, &budget.target_currency) {
        (Some(t), Some(tc)) if !tc.eq_ignore_ascii_case(&currency) => {
            let mut fx = crate::services::fx::fetch_rates().await?;
            crate::commands::calc::enrich_with_crypto(&mut fx, &currency, &db.pool).await;
            crate::commands::calc::enrich_with_crypto(&mut fx, tc, &db.pool).await;
            Some(crate::commands::calc::convert(t, tc, &currency, Some(&fx)))
        }
        (Some(t), _) => Some(t),
        _ => None,
    };

    let months_to_target = match target_in_budget_ccy {
        Some(target) if target > current_portfolio_value && monthly_addition > 0.0 => {
            let mut sim_v = current_portfolio_value;
            let mut months: i64 = 0;
            for _ in 0..1200 {
                if sim_v >= target {
                    break;
                }
                sim_v = sim_v * (1.0 + monthly_yield_rate) + monthly_addition;
                months += 1;
            }
            if months >= 1200 {
                None
            } else {
                Some(months)
            }
        }
        _ => None,
    };

    Ok(BudgetProjection {
        budget_id,
        currency,
        monthly_savings,
        current_portfolio_value,
        monthly_passive_income,
        months_to_target,
        trajectory,
    })
}
