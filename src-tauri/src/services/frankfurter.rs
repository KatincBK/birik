//! Frankfurter API — ECB döviz kurları, key'siz.
//! https://api.frankfurter.dev/latest?base=TRY&symbols=USD,EUR,...
//!
//! TCMB fallback'i olarak kullanılır. Frankfurter "1 TRY = X foreign" formunda
//! döner; bizim TCMB formatımız "1 foreign = X TRY" — invert ederek aynı
//! semantiği elde ediyoruz.
//!
//! Tarihsel sorgu: `https://api.frankfurter.dev/{YYYY-MM-DD}?base=USD`
//! Response: `{ "rates": { "TRY": 32.5, "EUR": 0.92 } }` — 1 USD karşılığı
//! diğer currency'ler. Hafta sonu/tatil ise en yakın iş gününe yuvarlar.

use std::collections::HashMap;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::services::http::HTTP;
use crate::services::tcmb::FxRates;

const URL: &str = "https://api.frankfurter.dev/latest?base=TRY";

/// Tarihsel kur cache: "YYYY-MM-DD" → 1 USD karşılığı diğer currency map.
/// Tarihsel kurlar değişmediği için süresiz cache.
#[allow(clippy::type_complexity)]
static HISTORICAL_CACHE: Lazy<Mutex<HashMap<String, HashMap<String, f64>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Desteklenen para birimleri cache'i (kod → tam isim). Frankfurter /currencies.
#[allow(clippy::type_complexity)]
static CURRENCIES_CACHE: Lazy<Mutex<Option<Vec<(String, String)>>>> =
    Lazy::new(|| Mutex::new(None));

/// Tüm desteklenen para birimlerini Frankfurter'dan çek. Cache'li.
/// Dönüş: `[(code, full_name), ...]` örn `("USD", "United States Dollar")`.
pub async fn list_supported_currencies() -> AppResult<Vec<(String, String)>> {
    {
        let cache = CURRENCIES_CACHE.lock().unwrap();
        if let Some(v) = cache.as_ref() {
            return Ok(v.clone());
        }
    }
    let url = "https://api.frankfurter.dev/currencies";
    let resp = HTTP.get(url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "Frankfurter /currencies HTTP {}",
            resp.status()
        )));
    }
    let map: HashMap<String, String> = resp.json().await?;
    let mut out: Vec<(String, String)> =
        map.into_iter().map(|(k, v)| (k.to_uppercase(), v)).collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    {
        let mut cache = CURRENCIES_CACHE.lock().unwrap();
        *cache = Some(out.clone());
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
struct FrankfurterResponse {
    #[allow(dead_code)]
    base: String,
    rates: HashMap<String, f64>,
}

pub async fn fetch_rates() -> AppResult<FxRates> {
    let resp = HTTP.get(URL).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "Frankfurter HTTP {}",
            resp.status()
        )));
    }
    let body: FrankfurterResponse = resp.json().await?;

    // Frankfurter rates: "USD" -> "1 TRY karşılığı USD" (örn 0.025).
    // Bizim formatımız: "USD" -> "1 USD karşılığı TRY" (örn 40.0).
    // Yani 1 / rate gerekli.
    let mut converted = HashMap::with_capacity(body.rates.len());
    for (code, val) in body.rates {
        if val > 0.0 {
            converted.insert(code, 1.0 / val);
        }
    }

    Ok(FxRates {
        fetched_at: chrono::Utc::now().timestamp(),
        rates: converted,
    })
}

/// 1 native currency için USD karşılığı, belirtilen tarihte.
/// USD → 1.0 (loopback). Hafta sonu/tatil → en yakın iş günü (Frankfurter davranışı).
/// Cache: aynı tarih için tek HTTP fetch.
///
/// `date_iso` format: "YYYY-MM-DD". `currency` ISO code (USD, TRY, EUR…).
pub async fn fetch_to_usd_at(date_iso: &str, currency: &str) -> AppResult<f64> {
    let upper = currency.to_uppercase();
    if upper == "USD" {
        return Ok(1.0);
    }

    // Cache hit?
    {
        let cache = HISTORICAL_CACHE.lock().unwrap();
        if let Some(rates) = cache.get(date_iso) {
            if let Some(rate) = rates.get(&upper) {
                if *rate > 0.0 {
                    return Ok(*rate);
                }
            }
        }
    }

    let url = format!("https://api.frankfurter.dev/{date_iso}?base=USD");
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "Frankfurter historical HTTP {} (date={date_iso})",
            resp.status()
        )));
    }
    let body: FrankfurterResponse = resp.json().await?;

    // Frankfurter base=USD: rates[X] = 1 USD karşılığı X. fx_to_usd = 1/rates[X].
    let mut to_usd: HashMap<String, f64> = HashMap::with_capacity(body.rates.len());
    for (code, val) in &body.rates {
        if *val > 0.0 {
            to_usd.insert(code.clone(), 1.0 / val);
        }
    }
    let result = to_usd.get(&upper).copied();

    // Cache yaz
    {
        let mut cache = HISTORICAL_CACHE.lock().unwrap();
        cache.insert(date_iso.to_string(), to_usd);
    }

    result.ok_or_else(|| {
        AppError::external(format!(
            "Frankfurter historical: {currency} not in response (date={date_iso})"
        ))
    })
}

/// Frankfurter range — `from..to` arası günlük kurlar.
/// Dönüş: (timestamp_ms, 1 USD = X currency oranı). USD asset için trivially 1.0 dizisi.
///
/// `from_iso`/`to_iso`: "YYYY-MM-DD". `currency`: "TRY", "EUR", vs.
pub async fn fetch_range_to_usd(
    from_iso: &str,
    to_iso: &str,
    currency: &str,
) -> AppResult<Vec<(i64, f64)>> {
    let upper = currency.to_uppercase();
    if upper == "USD" {
        return Ok(vec![]);
    }

    #[derive(Debug, Deserialize)]
    struct Resp {
        rates: HashMap<String, HashMap<String, f64>>,
    }

    let url = format!(
        "https://api.frankfurter.dev/{from_iso}..{to_iso}?base=USD&symbols={}",
        upper
    );
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "Frankfurter range HTTP {} ({from_iso}..{to_iso} {upper})",
            resp.status()
        )));
    }
    let body: Resp = resp.json().await?;

    let mut out: Vec<(i64, f64)> = Vec::with_capacity(body.rates.len());
    for (date_str, map) in body.rates {
        if let Some(rate) = map.get(&upper) {
            // 1 USD = rate currency → 1 currency = 1/rate USD = fx_to_usd
            if *rate > 0.0 {
                if let Ok(d) = chrono::NaiveDate::parse_from_str(&date_str, "%Y-%m-%d") {
                    if let Some(dt) = d.and_hms_opt(0, 0, 0) {
                        let ms = dt.and_utc().timestamp_millis();
                        out.push((ms, 1.0 / rate));
                    }
                }
            }
        }
    }
    out.sort_by_key(|(ts, _)| *ts);
    Ok(out)
}
