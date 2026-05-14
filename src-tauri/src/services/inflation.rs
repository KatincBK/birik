//! ABD Core CPI (enflasyon) — BLS Public Data API v1, **key gerektirmez**.
//!
//! "Reel" yıllık getiri hesabında kullanılır: her nakit akışı, yapıldığı ayın
//! CPI'ına göre bugünün doları satın alma gücüne çekilir, sonra XIRR alınır.
//!
//! Aylık veri, nadir değişir → process-içi cache (12 saat TTL). Hata olursa
//! eski cache; o da yoksa None → çağıran nominal hesaba geri düşer.
//! BLS kayıtsız limiti 25 sorgu/gün — cache ile fazlasıyla yeter.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::services::http::HTTP;

/// ABD Core CPI serisi — (yıl, ay) → endeks değeri + en güncel değer.
#[derive(Debug, Clone)]
pub struct CpiSeries {
    by_month: HashMap<(i32, u32), f64>,
    latest: f64,
}

impl CpiSeries {
    /// `(yıl, ay)` ayındaki bir tutarı bugünün doları değerine çeviren faktör
    /// (`CPI_bugün / CPI_o_ay`). O ayın verisi yoksa 1.0 (deflasyon yapma).
    pub fn deflator(&self, year: i32, month: u32) -> f64 {
        match self.by_month.get(&(year, month)) {
            Some(&cpi) if cpi > 0.0 => self.latest / cpi,
            _ => 1.0,
        }
    }
}

struct CacheEntry {
    series: CpiSeries,
    fetched_at: i64,
}

fn cache() -> &'static Mutex<Option<CacheEntry>> {
    static C: OnceLock<Mutex<Option<CacheEntry>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

const CACHE_TTL_SECS: i64 = 12 * 3600;

/// Cache fresh ise onu, değilse BLS'ten çeker. Hata → eski cache; o da yoksa
/// None (çağıran nominal'e düşer).
pub async fn fetch_core_cpi() -> Option<CpiSeries> {
    let now = chrono::Utc::now().timestamp();
    {
        let guard = cache().lock().unwrap();
        if let Some(e) = guard.as_ref() {
            if now - e.fetched_at < CACHE_TTL_SECS {
                return Some(e.series.clone());
            }
        }
    }
    match fetch_fresh().await {
        Ok(series) => {
            let mut guard = cache().lock().unwrap();
            *guard = Some(CacheEntry {
                series: series.clone(),
                fetched_at: now,
            });
            Some(series)
        }
        Err(e) => {
            log::warn!("[birik] CPI çekilemedi: {e}");
            cache().lock().unwrap().as_ref().map(|c| c.series.clone())
        }
    }
}

async fn fetch_fresh() -> AppResult<CpiSeries> {
    #[derive(Deserialize)]
    struct Resp {
        status: String,
        #[serde(rename = "Results")]
        results: Option<Results>,
    }
    #[derive(Deserialize)]
    struct Results {
        series: Vec<Series>,
    }
    #[derive(Deserialize)]
    struct Series {
        data: Vec<Point>,
    }
    #[derive(Deserialize)]
    struct Point {
        year: String,
        period: String,
        value: String,
    }

    let this_year: i32 = chrono::Utc::now()
        .format("%Y")
        .to_string()
        .parse()
        .unwrap_or(2026);
    // BLS v1 azami 10 yıllık aralık — her gerçekçi portföyü kapsar.
    let body = serde_json::json!({
        // CUUR0000SA0L1E = ABD Core CPI (gıda+enerji hariç), mevsimsel
        // düzeltmesiz endeks. Kullanıcının Excel'i de "Core" kullanıyordu.
        "seriesid": ["CUUR0000SA0L1E"],
        "startyear": (this_year - 9).to_string(),
        "endyear": this_year.to_string(),
    });

    let resp = HTTP
        .post("https://api.bls.gov/publicAPI/v1/timeseries/data/")
        .json(&body)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!("BLS HTTP {}", resp.status())));
    }
    let body: Resp = resp.json().await?;
    if body.status != "REQUEST_SUCCEEDED" {
        return Err(AppError::external(format!("BLS status: {}", body.status)));
    }
    let series = body
        .results
        .and_then(|r| r.series.into_iter().next())
        .ok_or_else(|| AppError::external("BLS: seri dönmedi"))?;

    let mut by_month: HashMap<(i32, u32), f64> = HashMap::new();
    let mut latest_key: Option<(i32, u32)> = None;
    for p in series.data {
        // period "M01".."M12" — "M13" (yıllık ortalama) atlanır
        if !p.period.starts_with('M') {
            continue;
        }
        let month: u32 = match p.period[1..].parse() {
            Ok(m) if (1..=12).contains(&m) => m,
            _ => continue,
        };
        let year: i32 = match p.year.parse() {
            Ok(y) => y,
            Err(_) => continue,
        };
        let value: f64 = match p.value.parse() {
            Ok(v) if v > 0.0 => v,
            _ => continue,
        };
        by_month.insert((year, month), value);
        if latest_key.map_or(true, |k| (year, month) > k) {
            latest_key = Some((year, month));
        }
    }

    let latest = latest_key
        .and_then(|k| by_month.get(&k).copied())
        .ok_or_else(|| AppError::external("BLS: geçerli CPI verisi yok"))?;

    Ok(CpiSeries { by_month, latest })
}
