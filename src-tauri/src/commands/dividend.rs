//! Hisse temettü projeksiyonu — sahip olunan hisselerin geçmiş temettü
//! verisinden önümüzdeki 12 ayın temettü gelirini öngörür.
//!
//! Veri: Yahoo chart `events=div` (ücretsiz). Elle giriş yok.
//! Algoritma: son ödemelerin aralıklarından sıklık tespit edilir
//! (aylık/çeyreklik/yarıyıllık/yıllık), tipik hisse-başı tutar × yıllık
//! ödeme sayısı ile yıllık projeksiyon yapılır. Sıklık belirsizse son 12 ay
//! toplamı (TTM) kullanılır. Son temettü, sıklığa göre makul süreden eskiyse
//! şirket ödemeyi kesmiş kabul edilir → projeksiyon 0.
//!
//! Sonuç asset para biriminde döner; display currency'ye çevirme frontend'de.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::State;

use crate::commands::now_secs;
use crate::error::AppResult;
use crate::services::yahoo::{self, DividendEvent};
use crate::services::Db;

// ---- Process-wide in-memory cache (temettü geçmişi nadiren değişir) ----

struct CacheEntry {
    events: Vec<DividendEvent>,
    fetched_at: i64,
}

fn cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    static C: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

const CACHE_TTL_SECS: i64 = 6 * 3600;

/// Sembol için temettü geçmişi — cache'ten ya da Yahoo'dan. Hata → boş liste
/// (eski cache varsa o kullanılır). `symbol` owned alınır ki future'lar
/// `join_all` ile paralel çalışabilsin.
async fn dividends_cached(symbol: String) -> Vec<DividendEvent> {
    let key = symbol.trim().to_uppercase();
    if key.is_empty() {
        return Vec::new();
    }
    let now = now_secs();
    {
        let guard = cache().lock().unwrap();
        if let Some(e) = guard.get(&key) {
            if now - e.fetched_at < CACHE_TTL_SECS {
                return e.events.clone();
            }
        }
    }
    match yahoo::fetch_dividends(&key).await {
        Ok(events) => {
            let mut guard = cache().lock().unwrap();
            guard.insert(
                key,
                CacheEntry {
                    events: events.clone(),
                    fetched_at: now,
                },
            );
            events
        }
        Err(e) => {
            log::warn!("[birik] temettü çekilemedi {key}: {e}");
            // Hata → varsa eski cache, yoksa boş
            cache()
                .lock()
                .unwrap()
                .get(&key)
                .map(|e| e.events.clone())
                .unwrap_or_default()
        }
    }
}

// ---- Projeksiyon ----

#[derive(Debug, Serialize)]
pub struct DividendProjection {
    pub asset_id: i64,
    pub symbol: String,
    pub name: String,
    pub icon_url: Option<String>,
    /// Kullanıcının elindeki hisse adedi
    pub balance: f64,
    pub asset_currency: String,
    /// "monthly" | "quarterly" | "semiannual" | "annual" | "irregular" | "none" | "stopped"
    pub frequency: String,
    /// Yılda kaç ödeme (sıklıktan; irregular/none/stopped → 0)
    pub payments_per_year: f64,
    /// Tipik hisse başı ödeme tutarı (asset para biriminde)
    pub per_payment: f64,
    /// Hisse başı yıllık projeksiyon (asset para biriminde)
    pub annual_per_share: f64,
    /// Kullanıcının pozisyonu için yıllık projeksiyon (asset para biriminde)
    /// = annual_per_share * balance
    pub annual_native: f64,
    /// `annual_native`'in display currency'ye çevrilmiş hali — Pasif gelir
    /// sayfası ve Anasayfa bunu kullanır (iki yerde tutarlı toplam).
    pub annual_display: f64,
    /// En son temettü ex-tarihi (unix sec), geçmiş yoksa None
    pub last_ex_date: Option<i64>,
}

struct Projected {
    frequency: &'static str,
    payments_per_year: f64,
    per_payment: f64,
    annual_per_share: f64,
}

/// Geçmiş temettülerden ileriye projeksiyon. `divs` ex-tarihe göre artan sıralı.
fn project(divs: &[DividendEvent], now: i64) -> Projected {
    let none = Projected {
        frequency: "none",
        payments_per_year: 0.0,
        per_payment: 0.0,
        annual_per_share: 0.0,
    };
    if divs.is_empty() {
        return none;
    }
    let last_ex = divs[divs.len() - 1].ex_date;

    // Sıklık: son (en fazla) 8 ödemenin aralıklarının medyanı, gün cinsinden
    let recent: Vec<&DividendEvent> = divs.iter().rev().take(8).collect(); // yeni → eski
    let mut gaps: Vec<f64> = recent
        .windows(2)
        .map(|w| (w[0].ex_date - w[1].ex_date).abs() as f64 / 86_400.0)
        .collect();
    gaps.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median_gap = if gaps.is_empty() {
        None
    } else {
        Some(gaps[gaps.len() / 2])
    };

    let (frequency, ppy): (&'static str, f64) = match median_gap {
        Some(g) if (20.0..=45.0).contains(&g) => ("monthly", 12.0),
        Some(g) if (60.0..=120.0).contains(&g) => ("quarterly", 4.0),
        Some(g) if (150.0..=240.0).contains(&g) => ("semiannual", 2.0),
        Some(g) if (300.0..=430.0).contains(&g) => ("annual", 1.0),
        _ => ("irregular", 0.0),
    };

    // "Aktif mi" — son temettü, sıklığa göre makul bir süre içinde mi?
    // Değilse şirket ödemeyi kesmiş kabul edilir (projeksiyon yapılmaz).
    let grace_days: f64 = if ppy >= 4.0 {
        200.0
    } else if ppy >= 2.0 {
        290.0
    } else {
        430.0
    };
    if (now - last_ex) as f64 / 86_400.0 > grace_days {
        return Projected {
            frequency: "stopped",
            ..none
        };
    }

    // Tipik ödeme: son `ppy` ödemenin ortalaması (irregular → son 4).
    // Tek seferlik özel temettüleri biraz yumuşatır.
    let n = if ppy >= 1.0 { ppy as usize } else { 4 };
    let last_n: Vec<f64> = divs.iter().rev().take(n).map(|d| d.amount).collect();
    let per_payment = if last_n.is_empty() {
        0.0
    } else {
        last_n.iter().sum::<f64>() / last_n.len() as f64
    };

    let annual_per_share = if ppy > 0.0 {
        // Sıklık tespit edildi → sıklık × tipik tutar
        per_payment * ppy
    } else {
        // Sıklık belirsiz ama aktif → son 12 ay toplamı (TTM)
        let one_year_ago = now - 365 * 86_400;
        divs.iter()
            .filter(|d| d.ex_date >= one_year_ago)
            .map(|d| d.amount)
            .sum()
    };

    Projected {
        frequency,
        payments_per_year: ppy,
        per_payment,
        annual_per_share,
    }
}

#[derive(sqlx::FromRow)]
struct StockRow {
    id: i64,
    symbol: String,
    name: String,
    icon_url: Option<String>,
    currency: String,
    external_id: Option<String>,
}

/// Çekirdek projeksiyon mantığı — hem `project_dividends` komutu hem de
/// `home_summary` ortak kullanır ki "yıllık pasif gelir" iki yerde tutarlı
/// olsun. Bakiyesi 0 olan (tamamen satılmış) hisseler dahil edilmez.
/// `annual_display` asset para biriminden display currency'ye çevrilir.
pub async fn compute_projections(
    pool: &sqlx::SqlitePool,
    profile_id: i64,
    display_currency: &str,
) -> AppResult<Vec<DividendProjection>> {
    let rows: Vec<StockRow> = sqlx::query_as(
        "SELECT a.id, a.symbol, a.name, a.icon_url, a.currency, a.external_id
         FROM assets a
         JOIN portfolios p ON p.id = a.portfolio_id
         WHERE p.profile_id = ? AND a.type = 'stock'
         ORDER BY a.symbol",
    )
    .bind(profile_id)
    .fetch_all(pool)
    .await?;

    // Her hisse için net bakiye — 0 olanları ele
    let mut prepared: Vec<(StockRow, f64)> = Vec::new();
    for r in rows {
        let balance: Option<f64> = sqlx::query_scalar(
            "SELECT SUM(CASE WHEN type IN ('buy','passive_income') THEN quantity
                             WHEN type = 'sell' THEN -quantity ELSE 0 END)
             FROM transactions WHERE asset_id = ? AND is_deleted = 0",
        )
        .bind(r.id)
        .fetch_one(pool)
        .await?;
        let balance = balance.unwrap_or(0.0);
        if balance > 1e-9 {
            prepared.push((r, balance));
        }
    }

    // Temettü geçmişlerini paralel çek (Yahoo)
    let div_futures: Vec<_> = prepared
        .iter()
        .map(|(r, _)| {
            let sym = r
                .external_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(r.symbol.as_str())
                .to_string();
            dividends_cached(sym)
        })
        .collect();
    let all_divs = futures_util::future::join_all(div_futures).await;

    // FX — asset para birimi → display currency (USD→USD ise no-op).
    let fx = crate::services::fx::fetch_rates().await.ok();
    let now = now_secs();
    let mut out = Vec::with_capacity(prepared.len());
    for ((r, balance), divs) in prepared.into_iter().zip(all_divs) {
        let p = project(&divs, now);
        let annual_native = p.annual_per_share * balance;
        let annual_display = crate::commands::calc::convert(
            annual_native,
            &r.currency,
            display_currency,
            fx.as_ref(),
        );
        out.push(DividendProjection {
            asset_id: r.id,
            symbol: r.symbol,
            name: r.name,
            icon_url: r.icon_url,
            balance,
            asset_currency: r.currency,
            frequency: p.frequency.to_string(),
            payments_per_year: p.payments_per_year,
            per_payment: p.per_payment,
            annual_per_share: p.annual_per_share,
            annual_native,
            annual_display,
            last_ex_date: divs.last().map(|d| d.ex_date),
        });
    }
    Ok(out)
}

/// Bir profilin tüm hisselerinin önümüzdeki 12 ay temettü projeksiyonu.
#[tauri::command]
pub async fn project_dividends(
    db: State<'_, Db>,
    profile_id: i64,
    display_currency: String,
) -> AppResult<Vec<DividendProjection>> {
    compute_projections(&db.pool, profile_id, &display_currency).await
}
