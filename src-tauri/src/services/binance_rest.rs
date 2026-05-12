//! Binance REST — kripto fiyat fetcher.
//! Ücretsiz, key'siz, ~1200 req/dk (CoinGecko'nun ~40 katı).
//!
//! Endpoint: https://api.binance.com/api/v3/ticker/24hr?symbol={SYM}USDT
//! Cevap: { "lastPrice": "80350.50", "priceChangePercent": "1.234", ... }

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::services::http::HTTP;

const BASE: &str = "https://api.binance.com/api/v3";

#[derive(Debug, Clone)]
pub struct CryptoQuote {
    pub symbol: String,
    pub usd_price: f64,
    pub change_24h_pct: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct TickerResponse {
    #[serde(rename = "lastPrice")]
    last_price: String,
    #[serde(rename = "priceChangePercent")]
    price_change_percent: String,
}

/// Sembol "BTC" → Binance pair "BTCUSDT". Stablecoin'ler için BUSDUSDT yok,
/// USDC için USDCUSDT da olmayabilir; bu durumlar caller'ın tayinindedir.
pub async fn fetch_quote(symbol: &str) -> AppResult<CryptoQuote> {
    let s = symbol.trim().to_uppercase();
    if s.is_empty() {
        return Err(AppError::validation("Sembol boş"));
    }
    // Stablecoin USDT'nin kendisi → 1.0 sabitleyelim
    if s == "USDT" {
        return Ok(CryptoQuote {
            symbol: s,
            usd_price: 1.0,
            change_24h_pct: Some(0.0),
        });
    }
    let pair = format!("{}USDT", s);
    let url = format!(
        "{BASE}/ticker/24hr?symbol={}",
        crate::services::url::encode(&pair)
    );
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "Binance HTTP {} ({})",
            resp.status(),
            pair
        )));
    }
    let body: TickerResponse = resp.json().await?;
    let price: f64 = body
        .last_price
        .parse()
        .map_err(|e| AppError::external(format!("Binance price parse: {e}")))?;
    let pct: f64 = body.price_change_percent.parse().unwrap_or(0.0);
    Ok(CryptoQuote {
        symbol: s,
        usd_price: price,
        change_24h_pct: Some(pct),
    })
}

/// Binance Klines — historical OHLC candles. Bizim ihtiyaç: (open_time_ms, close_price).
///
/// `interval`: "5m" | "15m" | "1h" | "4h" | "1d" | "1w"
/// `limit`: max 1000
///
/// Response array: [[open_time, open, high, low, close, volume, close_time, ...], ...]
pub async fn fetch_klines(
    symbol: &str,
    interval: &str,
    limit: usize,
) -> AppResult<Vec<(i64, f64)>> {
    let s = symbol.trim().to_uppercase();
    if s.is_empty() {
        return Err(AppError::validation("Sembol boş"));
    }
    if s == "USDT" {
        // Stablecoin için tarihsel grafik gereksiz; tek nokta dön
        let now = chrono::Utc::now().timestamp_millis();
        return Ok(vec![(now, 1.0)]);
    }
    let pair = format!("{}USDT", s);
    let url = format!(
        "{BASE}/klines?symbol={}&interval={}&limit={}",
        crate::services::url::encode(&pair),
        crate::services::url::encode(interval),
        limit.min(1000)
    );
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "Binance klines HTTP {} ({pair} {interval})",
            resp.status()
        )));
    }
    let body: Vec<serde_json::Value> = resp.json().await?;
    let mut out = Vec::with_capacity(body.len());
    for row in body {
        if let Some(arr) = row.as_array() {
            let open_time = arr.first().and_then(|v| v.as_i64()).unwrap_or(0);
            // close = index 4, string olarak gelir
            let close = arr
                .get(4)
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(0.0);
            if close > 0.0 {
                out.push((open_time, close));
            }
        }
    }
    Ok(out)
}
