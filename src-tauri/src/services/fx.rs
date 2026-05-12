//! Döviz kuru abstraction. Önce TCMB (resmi, gün başı), başarısızsa
//! Frankfurter (ECB, gerçek zamanlı). İkisi de aynı format döner:
//! `FxRates { rates: { "USD": <1 USD karşılığı TRY> } }`.

use crate::error::AppResult;
use crate::services::{frankfurter, tcmb};
use crate::services::tcmb::FxRates;

/// Önce TCMB; ağ hatası, format hatası veya boş rates dönerse Frankfurter.
pub async fn fetch_rates() -> AppResult<FxRates> {
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
