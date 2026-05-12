//! TCMB (Türkiye Merkez Bankası) günlük döviz/altın kurları.
//! XML, key gerektirmiyor, ~15:30'da güncelleniyor (haftaiçi).
//! PLAN §3 endpoint:
//!   https://www.tcmb.gov.tr/kurlar/today.xml

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::services::http::HTTP;

const URL: &str = "https://www.tcmb.gov.tr/kurlar/today.xml";

/// XML root: <Tarih_Date>… <Currency Kod="USD">…</Currency>… </Tarih_Date>
#[derive(Debug, Deserialize)]
struct TcmbXml {
    #[serde(rename = "Currency", default)]
    currencies: Vec<TcmbCurrency>,
    #[serde(rename = "@Date", default)]
    #[allow(dead_code)]
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TcmbCurrency {
    #[serde(rename = "@Kod")]
    kod: String,
    #[serde(rename = "@Unit", default)]
    unit: Option<String>,
    /// Forex Selling — döviz satış kuru (TRY karşılığı). Birim Unit kadar.
    #[serde(rename = "ForexSelling", default)]
    forex_selling: Option<String>,
    /// Forex Buying — döviz alış. Bazı kayıtlarda satış boş ise fallback.
    #[serde(rename = "ForexBuying", default)]
    forex_buying: Option<String>,
}

/// PLAN §3: TRY karşılığı 1 birim döviz fiyatları. Map "USD" -> 32.45 gibi.
/// Altın da aynı XML'de var: "XAU" kodu (gram altın).
#[derive(Debug, Clone, Serialize)]
pub struct FxRates {
    pub fetched_at: i64,
    /// "USD", "EUR", "GBP", "XAU"... anahtarlı, 1 birim için TRY değeri.
    pub rates: HashMap<String, f64>,
}

pub async fn fetch_rates() -> AppResult<FxRates> {
    let resp = HTTP.get(URL).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!("TCMB HTTP {}", resp.status())));
    }
    let body = resp.text().await?;
    let parsed: TcmbXml = quick_xml::de::from_str(&body)?;

    let mut rates = HashMap::with_capacity(parsed.currencies.len());
    for c in parsed.currencies {
        let unit: f64 = c
            .unit
            .as_deref()
            .and_then(|u| u.trim().parse().ok())
            .unwrap_or(1.0);
        let raw = c
            .forex_selling
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .or(c.forex_buying.as_deref())
            .unwrap_or("");
        let value: Option<f64> = raw.replace(',', ".").trim().parse().ok();
        if let Some(v) = value {
            // PLAN: 1 birim için TRY değeri istiyoruz. TCMB JPY gibi
            // Unit=100 ile veriyor → 100 JPY için TRY → 1 JPY için /100.
            let per_unit = if unit > 0.0 { v / unit } else { v };
            rates.insert(c.kod.to_uppercase(), per_unit);
        }
    }

    Ok(FxRates {
        fetched_at: chrono::Utc::now().timestamp(),
        rates,
    })
}
