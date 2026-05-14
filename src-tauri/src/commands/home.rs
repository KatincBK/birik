//! Anasayfa için tek atımlık özet komutu — profil bazlı.
//!
//! 5 kart için gereken metrikler:
//! - Mevcut portföy değeri ve toplam yatırılan (cost basis)
//! - Yıllıklaştırılmış getiri (CAGR — cost-weighted holding period)
//! - Aylık ortalama yatırım (bütçe entries gerçekleşen)
//! - Yıllık beklenen pasif gelir (Σ market_value × expected_yield_pct/100)
//! - Hedef değer ve ilerleme yüzdesi

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

use crate::error::AppResult;
use crate::services::Db;

#[derive(Debug, Clone, Serialize)]
pub struct HomeSummary {
    pub display_currency: String,
    pub total_value: f64,
    pub total_invested: f64,
    pub total_unrealized_pl: f64,
    /// Yıllıklaştırılmış getiri (CAGR). None: holding period yok.
    pub cagr_pct: Option<f64>,
    /// Bütçe entries ortalaması (income - expense). None: bütçe yok / entry yok.
    pub monthly_investment_avg: Option<f64>,
    /// Yıllık beklenen pasif gelir (display currency).
    pub passive_income_annual: f64,
    /// Bütçe target_value, display currency'ye convert edilmiş.
    pub target_value: Option<f64>,
    /// Hedefe ilerleme yüzdesi (0-100, clamp).
    pub target_progress_pct: Option<f64>,
    /// Aktif profilin bütçesi varsa ID — kart tıklaması için.
    pub budget_id: Option<i64>,
}

#[tauri::command]
pub async fn home_summary(
    db: State<'_, Db>,
    profile_id: i64,
    display_currency: String,
) -> AppResult<HomeSummary> {
    home_summary_inner(&db.pool, profile_id, &display_currency).await
}

async fn home_summary_inner(
    pool: &SqlitePool,
    profile_id: i64,
    display_currency: &str,
) -> AppResult<HomeSummary> {
    let display_currency = display_currency.to_uppercase();

    let portfolios: Vec<crate::db::models::Portfolio> = sqlx::query_as(
        "SELECT id, name, created_at, pinned, profile_id FROM portfolios WHERE profile_id = ?",
    )
    .bind(profile_id)
    .fetch_all(pool)
    .await?;

    let mut total_value = 0.0;
    let mut total_invested = 0.0;
    let mut total_unrealized = 0.0;
    let mut weighted_yield_value = 0.0;

    for p in &portfolios {
        let s = crate::commands::calc::calculate_portfolio_inner(
            pool,
            p.id,
            &display_currency,
        )
        .await?;
        total_value += s.total_value;
        total_invested += s.total_cost;
        total_unrealized += s.total_unrealized_pl;

        for a in &s.assets {
            // Hisseler temettü projeksiyonundan gelir (döngüden sonra eklenir);
            // burada sadece kripto/emtia/döviz'in elle girilmiş getirisi.
            if a.asset_type != "stock" {
                if let (Some(mv), Some(y)) = (a.market_value_display, a.expected_yield_pct) {
                    weighted_yield_value += mv * y / 100.0;
                }
            }
        }
    }

    // Hisse temettüleri — geçmiş veriden otomatik projeksiyon. Pasif gelir
    // sayfasıyla aynı çekirdek mantık (`dividend::compute_projections`) ki
    // "yıllık pasif gelir" iki ekranda da aynı çıksın.
    let div_projections = crate::commands::dividend::compute_projections(
        pool,
        profile_id,
        &display_currency,
    )
    .await
    .unwrap_or_default();
    for d in &div_projections {
        weighted_yield_value += d.annual_display;
    }

    let budget: Option<crate::db::models::Budget> = sqlx::query_as(
        "SELECT id, name, monthly_income, monthly_expense, currency,
                target_value, target_date, pinned, created_at, profile_id, target_currency
         FROM budgets WHERE profile_id = ? LIMIT 1",
    )
    .bind(profile_id)
    .fetch_optional(pool)
    .await?;

    // ----- Yatırım: investment_entries'ten USD-locked toplam → display'e dönüş
    // Multi-currency: bir ayda farklı currency satırları olabilir, hepsi
    // USD'ye çevrilip toplanır; ortalama unique year_month sayısına bölünür.
    let inv_rows: Vec<(String, String, f64, Option<f64>)> = sqlx::query_as(
        "SELECT year_month, currency, amount, fx_to_usd FROM investment_entries
         WHERE profile_id = ?",
    )
    .bind(profile_id)
    .fetch_all(pool)
    .await?;

    let mut needs_fx = !display_currency.eq_ignore_ascii_case("USD")
        || matches!(display_currency.as_str(), "BTC" | "ETH");
    for (_, ccy, _, _) in &inv_rows {
        if !ccy.eq_ignore_ascii_case(&display_currency) {
            needs_fx = true;
        }
    }

    let mut current_fx = None;
    if needs_fx {
        let mut rates = crate::services::fx::fetch_rates().await?;
        crate::commands::calc::enrich_with_crypto(&mut rates, &display_currency, pool).await;
        for (_, ccy, _, _) in &inv_rows {
            crate::commands::calc::enrich_with_crypto(&mut rates, ccy, pool).await;
        }
        current_fx = Some(rates);
    }

    let monthly_investment_avg: Option<f64> = if inv_rows.is_empty() {
        None
    } else {
        use std::collections::HashSet;
        let mut months: HashSet<String> = HashSet::new();
        let mut sum_usd = 0.0;
        for (ym, ccy, amount, fx) in &inv_rows {
            months.insert(ym.clone());
            let amount_usd = match fx {
                Some(f) if *f > 0.0 => amount * f,
                _ => crate::commands::calc::convert(*amount, ccy, "USD", current_fx.as_ref()),
            };
            sum_usd += amount_usd;
        }
        let n = months.len().max(1) as f64;
        let avg_usd = sum_usd / n;
        let avg_in_display = crate::commands::calc::convert(
            avg_usd,
            "USD",
            &display_currency,
            current_fx.as_ref(),
        );
        Some(avg_in_display)
    };

    // ----- Yıllık getiri (XIRR — para-ağırlıklı). Her para girişi kendi
    // tarihinden sayılır; naif "değer / yıl" bölmesi YOK. Kaynak: yatırım
    // kaydı (investment_entries) varsa ondan; yoksa — ya da ayar zorluyorsa —
    // alım/satım işlemlerinden (takaslar birbirini götürür). Hepsi USD'de.
    let force_cagr_tx: bool = {
        let raw: Option<String> = sqlx::query_scalar(
            "SELECT value FROM settings WHERE key = 'cagr_from_transactions'",
        )
        .fetch_optional(pool)
        .await?;
        raw.as_deref() == Some("true")
    };

    let cagr_pct = {
        let mut flows: Vec<(i64, f64)> = Vec::new();
        if !force_cagr_tx && !inv_rows.is_empty() {
            // Kaynak B — yatırım kayıtları (ay ortası tarihli giriş akışları)
            for (ym, ccy, amount, fx) in &inv_rows {
                if let Some(ts) = ym_to_unix(ym) {
                    let usd = match fx {
                        Some(f) if *f > 0.0 => amount * f,
                        _ => crate::commands::calc::convert(
                            *amount,
                            ccy,
                            "USD",
                            current_fx.as_ref(),
                        ),
                    };
                    flows.push((ts, -usd));
                }
            }
        } else {
            // Kaynak A — alım/satım işlemleri
            let tx_rows: Vec<(i64, String, f64, f64, f64, Option<f64>, String)> =
                sqlx::query_as(
                    "SELECT t.date, t.type, t.quantity, t.price, t.fee,
                            t.fx_to_usd, a.currency
                     FROM transactions t
                     JOIN assets a ON a.id = t.asset_id
                     JOIN portfolios p ON p.id = a.portfolio_id
                     WHERE p.profile_id = ? AND t.is_deleted = 0
                       AND t.type IN ('buy','sell')",
                )
                .bind(profile_id)
                .fetch_all(pool)
                .await?;
            for (date, ttype, qty, price, fee, fx, ccy) in &tx_rows {
                let (gross, sign) = if ttype.as_str() == "buy" {
                    (*qty * *price + *fee, -1.0) // alış: maliyet, para girişi
                } else {
                    (*qty * *price - *fee, 1.0) // satış: net hasılat, çıkış
                };
                let usd = match fx {
                    Some(f) if *f > 0.0 => gross * *f,
                    _ => crate::commands::calc::convert(
                        gross,
                        ccy,
                        "USD",
                        current_fx.as_ref(),
                    ),
                };
                flows.push((*date, sign * usd));
            }
        }
        // Final akış — bugünkü portföy değeri (USD)
        let total_value_usd = crate::commands::calc::convert(
            total_value,
            &display_currency,
            "USD",
            current_fx.as_ref(),
        );
        flows.push((chrono::Utc::now().timestamp(), total_value_usd));
        crate::services::xirr::xirr(&flows).map(|r| r * 100.0)
    };

    // ----- Hedef: budget.target_currency / target_value → display
    let (target_value_in_display, budget_id) = match &budget {
        Some(b) => {
            let target_ccy = b.target_currency.as_deref().unwrap_or(&b.currency);
            let mut fx_for_budget = current_fx.clone();
            if b.target_value.is_some() && !target_ccy.eq_ignore_ascii_case(&display_currency)
            {
                if fx_for_budget.is_none() {
                    let mut rates = crate::services::fx::fetch_rates().await?;
                    crate::commands::calc::enrich_with_crypto(&mut rates, &display_currency, pool)
                        .await;
                    crate::commands::calc::enrich_with_crypto(&mut rates, target_ccy, pool).await;
                    fx_for_budget = Some(rates);
                } else if let Some(fx) = fx_for_budget.as_mut() {
                    crate::commands::calc::enrich_with_crypto(fx, target_ccy, pool).await;
                }
            }
            let target = b.target_value.map(|t| {
                crate::commands::calc::convert(
                    t,
                    target_ccy,
                    &display_currency,
                    fx_for_budget.as_ref(),
                )
            });
            (target, Some(b.id))
        }
        None => (None, None),
    };

    let target_progress_pct = match target_value_in_display {
        Some(t) if t > 0.0 && total_value > 0.0 => {
            Some(((total_value / t) * 100.0).clamp(0.0, 100.0))
        }
        _ => None,
    };

    Ok(HomeSummary {
        display_currency,
        total_value,
        total_invested,
        total_unrealized_pl: total_unrealized,
        cagr_pct,
        monthly_investment_avg,
        passive_income_annual: weighted_yield_value,
        target_value: target_value_in_display,
        target_progress_pct,
        budget_id,
    })
}

/// "YYYY-MM" → o ayın 15'inin (ay ortası) unix timestamp'i. XIRR'de yatırım
/// kaydının tarihi olarak kullanılır.
fn ym_to_unix(ym: &str) -> Option<i64> {
    let mut parts = ym.split('-');
    let y: i32 = parts.next()?.trim().parse().ok()?;
    let m: u32 = parts.next()?.trim().parse().ok()?;
    let date = chrono::NaiveDate::from_ymd_opt(y, m, 15)?;
    Some(date.and_hms_opt(0, 0, 0)?.and_utc().timestamp())
}
