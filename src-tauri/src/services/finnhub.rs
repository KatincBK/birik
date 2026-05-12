//! Finnhub.io fetcher. Free tier 60 req/dk, key zorunlu.
//! Endpoint'ler:
//!   /quote?symbol={S}&token={K}                    — anlık fiyat + previousClose
//!   /search?q={Q}&token={K}                        — sembol arama
//!   /stock/profile2?symbol={S}&token={K}           — şirket profili (dividend yield, logo)
//!   /company-news?symbol={S}&from={F}&to={T}&token  — şirket haberleri

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::services::http::HTTP;

const BASE: &str = "https://finnhub.io/api/v1";

#[derive(Debug, Deserialize)]
struct QuoteResponse {
    /// current price
    c: f64,
    /// change (mutlak)
    #[serde(default)]
    #[allow(dead_code)]
    d: Option<f64>,
    /// percent change
    #[serde(default)]
    dp: Option<f64>,
    /// previous close
    pc: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StockQuote {
    pub symbol: String,
    pub price: f64,
    pub previous_close: Option<f64>,
    pub change_24h_pct: Option<f64>,
}

pub async fn fetch_quote(symbol: &str, api_key: &str) -> AppResult<StockQuote> {
    let s = symbol.trim().to_uppercase();
    if s.is_empty() {
        return Err(AppError::validation("Sembol boş"));
    }
    if api_key.is_empty() {
        return Err(AppError::validation("Finnhub API key boş"));
    }
    let url = format!(
        "{BASE}/quote?symbol={}&token={}",
        crate::services::url::encode(&s),
        crate::services::url::encode(api_key)
    );
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!("Finnhub HTTP {}", resp.status())));
    }
    let body: QuoteResponse = resp.json().await?;
    if body.c == 0.0 && body.pc == 0.0 {
        return Err(AppError::not_found(format!(
            "Finnhub sembolü tanımıyor: {s}"
        )));
    }
    Ok(StockQuote {
        symbol: s,
        price: body.c,
        previous_close: if body.pc > 0.0 { Some(body.pc) } else { None },
        change_24h_pct: body.dp,
    })
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    result: Vec<SearchItem>,
}

#[derive(Debug, Deserialize)]
struct SearchItem {
    symbol: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(rename = "displaySymbol", default)]
    #[allow(dead_code)]
    display_symbol: Option<String>,
    #[serde(rename = "type", default)]
    item_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub symbol: String,
    pub name: String,
    pub item_type: Option<String>,
}

pub async fn search(query: &str, api_key: &str) -> AppResult<Vec<SearchHit>> {
    let q = query.trim();
    if q.is_empty() || api_key.is_empty() {
        return Ok(vec![]);
    }
    let url = format!(
        "{BASE}/search?q={}&token={}",
        crate::services::url::encode(q),
        crate::services::url::encode(api_key)
    );
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "Finnhub search HTTP {}",
            resp.status()
        )));
    }
    let body: SearchResponse = resp.json().await?;
    Ok(body
        .result
        .into_iter()
        // Sadece common stock + ETF tut
        .filter(|i| {
            i.item_type
                .as_deref()
                .map(|t| {
                    let tu = t.to_ascii_uppercase();
                    tu == "COMMON STOCK" || tu == "ETF" || tu == "EQUITY"
                })
                .unwrap_or(true)
        })
        // Dot içeren sembolleri (genelde non-US) listenin altına alma:
        // Finnhub free tier sadece US'i destekler ama search uluslararası sonuç döner.
        .take(20)
        .map(|i| SearchHit {
            symbol: i.symbol,
            name: i.description.unwrap_or_default(),
            item_type: i.item_type,
        })
        .collect())
}

#[derive(Debug, Deserialize)]
struct ProfileResponse {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    logo: Option<String>,
    /// Yıllık dividend yield (%) — bu doğrudan yüzde olarak gelir
    #[serde(rename = "dividendYieldIndicatedAnnual", default)]
    dividend_yield: Option<f64>,
    #[serde(default)]
    #[allow(dead_code)]
    weburl: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompanyProfile {
    pub name: Option<String>,
    pub logo: Option<String>,
    /// Yıllık temettü yield % (Finnhub'ın "dividendYieldIndicatedAnnual"'undan)
    pub dividend_yield_pct: Option<f64>,
}

pub async fn company_profile(symbol: &str, api_key: &str) -> AppResult<CompanyProfile> {
    let s = symbol.trim().to_uppercase();
    if s.is_empty() || api_key.is_empty() {
        return Err(AppError::validation("Sembol veya key boş"));
    }
    let url = format!(
        "{BASE}/stock/profile2?symbol={}&token={}",
        crate::services::url::encode(&s),
        crate::services::url::encode(api_key)
    );
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "Finnhub profile HTTP {}",
            resp.status()
        )));
    }
    let body: ProfileResponse = resp.json().await?;
    Ok(CompanyProfile {
        name: body.name,
        logo: body.logo,
        dividend_yield_pct: body.dividend_yield,
    })
}

#[derive(Debug, Deserialize)]
struct NewsItem {
    headline: String,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    image: Option<String>,
    /// Unix timestamp (saniye)
    datetime: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetNews {
    pub headline: String,
    pub summary: Option<String>,
    pub url: Option<String>,
    pub source: Option<String>,
    pub image: Option<String>,
    pub datetime: i64,
}

/// Belirli bir hisse için tarih aralığında haberler. from_date/to_date YYYY-MM-DD.
pub async fn company_news(
    symbol: &str,
    api_key: &str,
    from_date: &str,
    to_date: &str,
) -> AppResult<Vec<AssetNews>> {
    let s = symbol.trim().to_uppercase();
    if s.is_empty() || api_key.is_empty() {
        return Ok(vec![]);
    }
    let url = format!(
        "{BASE}/company-news?symbol={}&from={}&to={}&token={}",
        crate::services::url::encode(&s),
        crate::services::url::encode(from_date),
        crate::services::url::encode(to_date),
        crate::services::url::encode(api_key)
    );
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "Finnhub news HTTP {}",
            resp.status()
        )));
    }
    let body: Vec<NewsItem> = resp.json().await?;
    Ok(body
        .into_iter()
        .take(10)
        .map(|n| AssetNews {
            headline: n.headline,
            summary: n.summary,
            url: n.url,
            source: n.source,
            image: n.image,
            datetime: n.datetime,
        })
        .collect())
}
