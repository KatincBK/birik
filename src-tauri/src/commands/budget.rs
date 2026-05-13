use chrono::Datelike;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

use crate::commands::now_secs;
use crate::db::models::{Budget, BudgetLine, BudgetMonthOverride};
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

const LINE_COLS: &str = "id, budget_id, kind, label, amount, currency, \
    start_ym, end_ym, fx_to_usd, note, created_at";

/// investment_entries ortalama aylık tutarı, display currency'de. Eğer veri
/// yoksa None. Profil bazlı. ETA trajectory'sinde "monthly_addition" olarak
/// kullanılır (budget income/expense ile karıştırılmaz).
async fn compute_avg_monthly_investment(
    pool: &SqlitePool,
    profile_id: Option<i64>,
    display_currency: &str,
) -> Option<f64> {
    let pid = profile_id?;
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
    .bind(pid)
    .fetch_all(pool)
    .await
    .ok()?;
    if rows.is_empty() {
        return None;
    }
    use std::collections::HashSet;
    let mut total_usd = 0.0;
    let mut months: HashSet<String> = HashSet::new();
    for r in &rows {
        let usd = if let Some(f) = r.fx_to_usd {
            r.amount * f
        } else if r.currency.eq_ignore_ascii_case("USD") {
            r.amount
        } else {
            continue;
        };
        total_usd += usd;
        months.insert(r.year_month.clone());
    }
    if total_usd <= 0.0 || months.is_empty() {
        return None;
    }
    let avg_usd = total_usd / months.len() as f64;
    let display = display_currency.to_uppercase();
    if display == "USD" {
        return Some(avg_usd);
    }
    // USD → display dönüşümü
    let fx = crate::services::fx::fetch_rates().await.ok()?;
    let mut fx_mut = fx;
    if display == "BTC" || display == "ETH" {
        crate::commands::calc::enrich_with_crypto(&mut fx_mut, &display, pool).await;
    }
    Some(crate::commands::calc::convert(
        avg_usd,
        "USD",
        &display,
        Some(&fx_mut),
    ))
}

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
 * Bütçe planlama: line items + month overrides
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

/// Geçerli 'YYYY-MM' formatı mı?
fn parse_ym(year_month: &str) -> Option<(i32, u32)> {
    let parts: Vec<&str> = year_month.split('-').collect();
    if parts.len() != 2 {
        return None;
    }
    let y: i32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    if !(1..=12).contains(&m) {
        return None;
    }
    Some((y, m))
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn upsert_budget_line(
    db: State<'_, Db>,
    id: Option<i64>,
    budget_id: i64,
    kind: String,
    label: String,
    amount: f64,
    currency: String,
    start_ym: String,
    end_ym: Option<String>,
    note: Option<String>,
) -> AppResult<BudgetLine> {
    let kind = kind.trim().to_lowercase();
    if kind != "income" && kind != "expense" {
        return Err(AppError::validation("kind 'income' veya 'expense' olmalı"));
    }
    let label = label.trim().to_string();
    if label.is_empty() {
        return Err(AppError::validation("Etiket boş olamaz"));
    }
    if !amount.is_finite() {
        return Err(AppError::validation("Tutar geçersiz"));
    }
    let currency = currency.trim().to_uppercase();
    if currency.is_empty() {
        return Err(AppError::validation("Para birimi boş olamaz"));
    }
    if parse_ym(&start_ym).is_none() {
        return Err(AppError::validation("Başlangıç ayı geçersiz (YYYY-MM)"));
    }
    if let Some(ref e) = end_ym {
        if !e.trim().is_empty() && parse_ym(e).is_none() {
            return Err(AppError::validation("Bitiş ayı geçersiz (YYYY-MM)"));
        }
        if !e.trim().is_empty() && e < &start_ym {
            return Err(AppError::validation("Bitiş ayı başlangıçtan önce olamaz"));
        }
    }
    let end_ym_clean = end_ym
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Tarihsel kur kilit — start_ym ay ortası için (best-effort, opsiyonel)
    let fx_to_usd: Option<f64> = match ym_to_mid_iso(&start_ym) {
        Some(date_iso) => crate::services::frankfurter::fetch_to_usd_at(
            &date_iso,
            &currency,
        )
        .await
        .ok()
        .filter(|v| *v > 0.0),
        None => None,
    };

    let row: BudgetLine = if let Some(line_id) = id {
        sqlx::query_as(&format!(
            "UPDATE budget_lines
             SET kind = ?, label = ?, amount = ?, currency = ?,
                 start_ym = ?, end_ym = ?, fx_to_usd = ?, note = ?
             WHERE id = ? AND budget_id = ?
             RETURNING {LINE_COLS}"
        ))
        .bind(&kind)
        .bind(&label)
        .bind(amount)
        .bind(&currency)
        .bind(&start_ym)
        .bind(&end_ym_clean)
        .bind(fx_to_usd)
        .bind(&note)
        .bind(line_id)
        .bind(budget_id)
        .fetch_optional(&db.pool)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Bütçe satırı bulunamadı: id={line_id}")))?
    } else {
        sqlx::query_as(&format!(
            "INSERT INTO budget_lines
                (budget_id, kind, label, amount, currency, start_ym, end_ym,
                 fx_to_usd, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING {LINE_COLS}"
        ))
        .bind(budget_id)
        .bind(&kind)
        .bind(&label)
        .bind(amount)
        .bind(&currency)
        .bind(&start_ym)
        .bind(&end_ym_clean)
        .bind(fx_to_usd)
        .bind(&note)
        .bind(now_secs())
        .fetch_one(&db.pool)
        .await?
    };
    Ok(row)
}

#[tauri::command]
pub async fn list_budget_lines(
    db: State<'_, Db>,
    budget_id: i64,
) -> AppResult<Vec<BudgetLine>> {
    let rows: Vec<BudgetLine> = sqlx::query_as(&format!(
        "SELECT {LINE_COLS} FROM budget_lines
         WHERE budget_id = ?
         ORDER BY kind, start_ym, label"
    ))
    .bind(budget_id)
    .fetch_all(&db.pool)
    .await?;
    Ok(rows)
}

#[tauri::command]
pub async fn delete_budget_line(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM budget_lines WHERE id = ?")
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Bütçe satırı bulunamadı: id={id}")));
    }
    Ok(())
}

/// Bir ayın grafikte interpole edilip edilmeyeceğini belirler.
/// interpolate=true → o ayın değerleri komşu ayların ortalamasıyla hesaplanır,
/// grafikte gri nokta olarak görünür.
#[tauri::command]
pub async fn set_budget_month_override(
    db: State<'_, Db>,
    budget_id: i64,
    year_month: String,
    interpolate: bool,
) -> AppResult<()> {
    if parse_ym(&year_month).is_none() {
        return Err(AppError::validation("year_month geçersiz (YYYY-MM)"));
    }
    sqlx::query(
        "INSERT INTO budget_month_overrides (budget_id, year_month, interpolate)
         VALUES (?, ?, ?)
         ON CONFLICT(budget_id, year_month) DO UPDATE SET interpolate = excluded.interpolate",
    )
    .bind(budget_id)
    .bind(year_month)
    .bind(if interpolate { 1_i64 } else { 0 })
    .execute(&db.pool)
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn list_budget_month_overrides(
    db: State<'_, Db>,
    budget_id: i64,
) -> AppResult<Vec<BudgetMonthOverride>> {
    let rows: Vec<BudgetMonthOverride> = sqlx::query_as(
        "SELECT budget_id, year_month, interpolate FROM budget_month_overrides
         WHERE budget_id = ?",
    )
    .bind(budget_id)
    .fetch_all(&db.pool)
    .await?;
    Ok(rows)
}

/* ----------------------------------------------------------------
 * Aylık özet (chart için)
 * ---------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize)]
pub struct MonthlyBudget {
    pub year_month: String,
    pub income_display: f64,
    pub expense_display: f64,
    pub net_display: f64,
    /// true = bu ayın değerleri interpole edilmiş (gri görünür).
    pub is_interpolated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BudgetPlan {
    pub budget_id: i64,
    pub display_currency: String,
    pub months: Vec<MonthlyBudget>,
}

/// Bütçe line item'larından aylık özet üretir.
/// `future_months`: bugünden itibaren kaç ay ileri göstereceğiz.
/// Geçmiş: line item'ların gerçek minimum start_ym'sinden bugüne kadar.
#[tauri::command]
pub async fn compute_budget_plan(
    db: State<'_, Db>,
    budget_id: i64,
    display_currency: String,
    future_months: Option<i64>,
) -> AppResult<BudgetPlan> {
    let display = display_currency.to_uppercase();
    let future = future_months.unwrap_or(12).clamp(0, 240);

    let lines: Vec<BudgetLine> = sqlx::query_as(&format!(
        "SELECT {LINE_COLS} FROM budget_lines WHERE budget_id = ?"
    ))
    .bind(budget_id)
    .fetch_all(&db.pool)
    .await?;

    let overrides: Vec<BudgetMonthOverride> = sqlx::query_as(
        "SELECT budget_id, year_month, interpolate FROM budget_month_overrides
         WHERE budget_id = ?",
    )
    .bind(budget_id)
    .fetch_all(&db.pool)
    .await?;
    let interpolate_set: std::collections::HashSet<String> = overrides
        .iter()
        .filter(|o| o.interpolate == 1)
        .map(|o| o.year_month.clone())
        .collect();

    if lines.is_empty() {
        return Ok(BudgetPlan {
            budget_id,
            display_currency: display,
            months: vec![],
        });
    }

    // Range hesabı: min(line.start_ym) .. max(today + future)
    let today = chrono::Utc::now().date_naive();
    let today_y = today.year() as i32;
    let today_m = today.month();
    let earliest_line: String = lines
        .iter()
        .map(|l| l.start_ym.clone())
        .min()
        .unwrap_or_else(|| format!("{:04}-{:02}", today_y, today_m));
    let (start_y, start_m) =
        parse_ym(&earliest_line).unwrap_or((today_y, today_m));

    let end_year = today_y + (today_m as i64 + future) as i32 / 12;
    let end_month_raw = (today_m as i64 - 1 + future) % 12 + 1;
    let end_year_adj = today_y + ((today_m as i64 - 1 + future) / 12) as i32;
    let _ = end_year; // unused
    let end_y = end_year_adj;
    let end_m = end_month_raw as u32;

    // Currency'lere göre FX rates (display'e çevirmek için bugünkü FX)
    let mut current_fx = crate::services::fx::fetch_rates().await.ok();
    if let Some(ref mut fx) = current_fx {
        if display == "BTC" || display == "ETH" {
            crate::commands::calc::enrich_with_crypto(fx, &display, &db.pool).await;
        }
    }

    // Bir ay (y, m) için line item'lardan total income/expense hesabı
    let month_total = |y: i32, m: u32, kind: &str| -> f64 {
        let ym = format!("{y:04}-{m:02}");
        let mut total_display = 0.0;
        for l in &lines {
            if l.kind != kind {
                continue;
            }
            if l.start_ym.as_str() > ym.as_str() {
                continue;
            }
            if let Some(end) = &l.end_ym {
                if ym.as_str() > end.as_str() {
                    continue;
                }
            }
            // line.currency → display
            let v = crate::commands::calc::convert(
                l.amount,
                &l.currency,
                &display,
                current_fx.as_ref(),
            );
            total_display += v;
        }
        total_display
    };

    // Önce raw aylar listesi: [(y,m, income, expense)]
    let mut raw: Vec<(i32, u32, f64, f64)> = Vec::new();
    let mut y = start_y;
    let mut m = start_m;
    loop {
        let income = month_total(y, m, "income");
        let expense = month_total(y, m, "expense");
        raw.push((y, m, income, expense));
        if y == end_y && m == end_m {
            break;
        }
        m += 1;
        if m > 12 {
            m = 1;
            y += 1;
        }
        // Sonsuz loop koruması (240+ ay)
        if raw.len() > 600 {
            break;
        }
    }

    // İkinci pass: interpolation (override flag + komşu ortalaması)
    let mut months: Vec<MonthlyBudget> = Vec::with_capacity(raw.len());
    for (i, (y, m, inc, exp)) in raw.iter().enumerate() {
        let ym = format!("{y:04}-{m:02}");
        let is_marked = interpolate_set.contains(&ym);
        if is_marked {
            // Komşu ayların ortalaması — gri nokta
            let prev_data = raw
                .iter()
                .take(i)
                .rev()
                .find(|(yy, mm, _, _)| {
                    let pym = format!("{yy:04}-{mm:02}");
                    !interpolate_set.contains(&pym)
                });
            let next_data = raw
                .iter()
                .skip(i + 1)
                .find(|(yy, mm, _, _)| {
                    let pym = format!("{yy:04}-{mm:02}");
                    !interpolate_set.contains(&pym)
                });
            let (inc_interp, exp_interp) = match (prev_data, next_data) {
                (Some(p), Some(n)) => ((p.2 + n.2) / 2.0, (p.3 + n.3) / 2.0),
                (Some(p), None) => (p.2, p.3),
                (None, Some(n)) => (n.2, n.3),
                (None, None) => (*inc, *exp),
            };
            months.push(MonthlyBudget {
                year_month: ym,
                income_display: inc_interp,
                expense_display: exp_interp,
                net_display: inc_interp - exp_interp,
                is_interpolated: true,
            });
        } else {
            months.push(MonthlyBudget {
                year_month: ym,
                income_display: *inc,
                expense_display: *exp,
                net_display: *inc - *exp,
                is_interpolated: false,
            });
        }
    }

    Ok(BudgetPlan {
        budget_id,
        display_currency: display,
        months,
    })
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
    // Aylık eklenen tutar = investment_entries ortalaması (budget income/expense
    // değil — kullanıcı net dedi: "gelir - gider = yatırım miktarı diyemeyiz").
    let monthly_savings = compute_avg_monthly_investment(
        &db.pool,
        budget.profile_id,
        &currency,
    )
    .await
    .unwrap_or(0.0);

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
