//! Döviz kuru abstraction. Önce TCMB (resmi, gün başı), başarısızsa
//! Frankfurter (ECB, gerçek zamanlı). İkisi de aynı format döner:
//! `FxRates { rates: { "USD": <1 USD karşılığı TRY> } }`.
//!
//! Process-wide in-memory cache: TCMB günlük güncelliyor, Frankfurter saatlik.
//! Aynı tick içinde currency cycle / portfolio_history / passive_income gibi
//! birden fazla çağırı aynı verilere ihtiyaç duyuyor. 10 dk TTL cache hem
//! TCMB'yi koruyor hem currency switch'i ücretsiz yapıyor.

use std::sync::OnceLock;

use tokio::sync::Mutex;

use crate::error::AppResult;
use crate::services::tcmb::FxRates;
use crate::services::{frankfurter, tcmb};

const CACHE_TTL_SECS: i64 = 10 * 60;

static CACHE: OnceLock<Mutex<Option<FxRates>>> = OnceLock::new();

fn cache_slot() -> &'static Mutex<Option<FxRates>> {
    CACHE.get_or_init(|| Mutex::new(None))
}

/// Cache'ten fresh ise onu döner; yoksa kaynaktan çeker ve cache'e yazar.
pub async fn fetch_rates() -> AppResult<FxRates> {
    let now = chrono::Utc::now().timestamp();
    {
        let guard = cache_slot().lock().await;
        if let Some(cached) = guard.as_ref() {
            if now - cached.fetched_at < CACHE_TTL_SECS && !cached.rates.is_empty() {
                return Ok(cached.clone());
            }
        }
    }

    let fresh = fetch_fresh().await?;

    {
        let mut guard = cache_slot().lock().await;
        *guard = Some(fresh.clone());
    }
    Ok(fresh)
}

/// TCMB → Frankfurter, cache devre dışı (yeni veri tazelemek için).
async fn fetch_fresh() -> AppResult<FxRates> {
    match tcmb::fetch_rates().await {
        Ok(r) if !r.rates.is_empty() => Ok(r),
        Ok(_empty) => {
            log::warn!("[birik] TCMB returned empty rates, falling back to Frankfurter");
            frankfurter::fetch_rates().await
        }
        Err(tcmb_err) => {
            log::warn!("[birik] TCMB fetch failed: {tcmb_err}, falling back to Frankfurter");
            match frankfurter::fetch_rates().await {
                Ok(r) => Ok(r),
                Err(frank_err) => Err(crate::error::AppError::external(format!(
                    "TCMB + Frankfurter ikisi de başarısız. TCMB: {tcmb_err}; Frankfurter: {frank_err}"
                ))),
            }
        }
    }
}
