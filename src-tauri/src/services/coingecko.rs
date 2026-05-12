//! CoinGecko fetcher. Key gerektirmiyor, ~30 req/dk limit.
//! PLAN §3 endpoints:
//!   /api/v3/simple/price?ids={id}&vs_currencies=usd,try,eur
//!   /api/v3/search?query={q}

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::services::http::HTTP;

const BASE: &str = "https://api.coingecko.com/api/v3";

/// CoinGecko `simple/price` cevabı: { "<id>": { "usd": 12345.6, "try": ..., "eur": ..., "usd_24h_change": -2.34 } }
type SimplePriceResponse = HashMap<String, HashMap<String, f64>>;

/// CoinGecko market_chart — historical USD prices.
/// `days`: "1" | "7" | "14" | "30" | "90" | "180" | "365" | "max"
pub async fn fetch_market_chart(
    coingecko_id: &str,
    days: &str,
) -> AppResult<Vec<(i64, f64)>> {
    #[derive(Debug, Deserialize)]
    struct Resp {
        prices: Vec<(f64, f64)>,
    }
    let id = coingecko_id.trim().to_lowercase();
    if id.is_empty() {
        return Err(AppError::validation("CoinGecko id boş"));
    }
    let url = format!(
        "{BASE}/coins/{}/market_chart?vs_currency=usd&days={}",
        crate::services::url::encode(&id),
        crate::services::url::encode(days)
    );
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "CoinGecko chart HTTP {} ({id} days={days})",
            resp.status()
        )));
    }
    let body: Resp = resp.json().await?;
    Ok(body
        .prices
        .into_iter()
        .filter(|(_, p)| *p > 0.0)
        .map(|(ts, p)| (ts as i64, p))
        .collect())
}

#[derive(Debug, Clone, Serialize)]
pub struct CryptoPrice {
    pub id: String,
    pub usd: f64,
    pub try_: f64,
    pub eur: f64,
    /// USD bazında son 24 saat % değişim. Yoksa None.
    pub usd_24h_change: Option<f64>,
}

pub async fn fetch_price(coingecko_id: &str) -> AppResult<CryptoPrice> {
    let id = coingecko_id.trim().to_lowercase();
    if id.is_empty() {
        return Err(AppError::validation("CoinGecko id boş"));
    }
    let url = format!(
        "{BASE}/simple/price?ids={}&vs_currencies=usd,try,eur&include_24hr_change=true",
        crate::services::url::encode(&id)
    );
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "CoinGecko HTTP {}",
            resp.status()
        )));
    }
    let body: SimplePriceResponse = resp.json().await?;
    let entry = body
        .get(&id)
        .ok_or_else(|| AppError::not_found(format!("CoinGecko id bulunamadı: {id}")))?;

    Ok(CryptoPrice {
        id: id.clone(),
        usd: entry.get("usd").copied().unwrap_or(0.0),
        try_: entry.get("try").copied().unwrap_or(0.0),
        eur: entry.get("eur").copied().unwrap_or(0.0),
        usd_24h_change: entry.get("usd_24h_change").copied(),
    })
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    coins: Vec<SearchCoin>,
}

#[derive(Debug, Deserialize)]
struct SearchCoin {
    id: String,
    symbol: String,
    name: String,
    #[serde(default)]
    large: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub external_id: String,
    pub symbol: String,
    pub name: String,
    pub icon: Option<String>,
}

pub async fn search(query: &str) -> AppResult<Vec<SearchHit>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let url = format!(
        "{BASE}/search?query={}",
        crate::services::url::encode(q)
    );
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "CoinGecko search HTTP {}",
            resp.status()
        )));
    }
    let body: SearchResponse = resp.json().await?;
    Ok(body
        .coins
        .into_iter()
        .take(20)
        .map(|c| SearchHit {
            external_id: c.id,
            symbol: c.symbol.to_uppercase(),
            name: c.name,
            icon: c.large,
        })
        .collect())
}

