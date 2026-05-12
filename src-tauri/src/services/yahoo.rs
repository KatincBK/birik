//! Yahoo Finance (resmi olmayan). Key gerektirmiyor.
//! PLAN §3 endpoints:
//!   query1.finance.yahoo.com/v8/finance/chart/{symbol}
//!   query2.finance.yahoo.com/v1/finance/search?q={q}
//!
//! Stooq.com fallback (PLAN §3 + §12 Faz 7): Yahoo bozulduğunda gün sonu
//! kapanış için stooq.com/q/d/l/?s={SYMBOL}.US&i=d&f=sd2t2ohlcv kullanılıyor.
//! `fetch_price` önce Yahoo'yu dener, başarısız olursa Stooq'tan CSV çeker.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::services::http::HTTP;

#[derive(Debug, Clone, Serialize)]
pub struct StockPrice {
    pub symbol: String,
    pub price: f64,
    pub currency: String,
    /// 24h karşılaştırma için. Yahoo previousClose'u verir; Stooq fallback'te aynı gün open
    /// kullanılıyor (yaklaşık).
    pub previous_close: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct ChartResponse {
    chart: ChartBody,
}

#[derive(Debug, Deserialize)]
struct ChartBody {
    result: Option<Vec<ChartResult>>,
    #[allow(dead_code)]
    error: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct ChartResult {
    meta: ChartMeta,
}

#[derive(Debug, Deserialize)]
struct ChartMeta {
    #[serde(rename = "regularMarketPrice")]
    regular_market_price: Option<f64>,
    #[serde(default)]
    currency: Option<String>,
    #[serde(default, rename = "previousClose")]
    previous_close: Option<f64>,
}

/// Yahoo chart historical — (timestamp_ms, close_price) listesi.
/// `range`: 1d | 5d | 1mo | 3mo | 6mo | 1y | 2y | 5y | max
/// `interval`: 5m | 15m | 1h | 1d | 1wk
pub async fn fetch_chart(
    symbol: &str,
    range: &str,
    interval: &str,
) -> AppResult<Vec<(i64, f64)>> {
    #[derive(Debug, Deserialize)]
    struct Resp {
        chart: Body,
    }
    #[derive(Debug, Deserialize)]
    struct Body {
        result: Option<Vec<Item>>,
    }
    #[derive(Debug, Deserialize)]
    struct Item {
        #[serde(default)]
        timestamp: Vec<i64>,
        indicators: Indicators,
    }
    #[derive(Debug, Deserialize)]
    struct Indicators {
        quote: Vec<Quote>,
    }
    #[derive(Debug, Deserialize)]
    struct Quote {
        #[serde(default)]
        close: Vec<Option<f64>>,
    }

    let s = symbol.trim().to_uppercase();
    if s.is_empty() {
        return Err(AppError::validation("Sembol boş"));
    }
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?range={}&interval={}",
        crate::services::url::encode(&s),
        crate::services::url::encode(range),
        crate::services::url::encode(interval)
    );
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "Yahoo chart HTTP {} ({s} range={range})",
            resp.status()
        )));
    }
    let body: Resp = resp.json().await?;
    let item = body
        .chart
        .result
        .and_then(|v| v.into_iter().next())
        .ok_or_else(|| AppError::external(format!("Yahoo chart no result for {s}")))?;
    let closes = item
        .indicators
        .quote
        .into_iter()
        .next()
        .map(|q| q.close)
        .unwrap_or_default();

    let mut out = Vec::with_capacity(item.timestamp.len());
    for (i, ts_sec) in item.timestamp.iter().enumerate() {
        if let Some(Some(c)) = closes.get(i) {
            if *c > 0.0 {
                out.push((ts_sec * 1000, *c));
            }
        }
    }
    Ok(out)
}

pub async fn fetch_price(symbol: &str) -> AppResult<StockPrice> {
    let s = symbol.trim().to_uppercase();
    if s.is_empty() {
        return Err(AppError::validation("Yahoo sembolü boş"));
    }

    // 1) Yahoo dene
    match fetch_yahoo(&s).await {
        Ok(p) => Ok(p),
        Err(yahoo_err) => {
            // 2) Stooq fallback. PLAN §3'te belirtilen gün sonu kapanış kaynağı.
            log::warn!("[birik] Yahoo failed for {s}: {yahoo_err}, trying Stooq…");
            match fetch_stooq(&s).await {
                Ok(p) => Ok(p),
                Err(stooq_err) => Err(crate::error::AppError::external(format!(
                    "Yahoo + Stooq her ikisi başarısız ({s}). Yahoo: {yahoo_err}; Stooq: {stooq_err}"
                ))),
            }
        }
    }
}

async fn fetch_yahoo(s: &str) -> AppResult<StockPrice> {
    let url = format!("https://query1.finance.yahoo.com/v8/finance/chart/{s}");
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!("Yahoo HTTP {}", resp.status())));
    }
    let body: ChartResponse = resp.json().await?;
    let result = body
        .chart
        .result
        .and_then(|v| v.into_iter().next())
        .ok_or_else(|| AppError::not_found(format!("Yahoo sembol bulunamadı: {s}")))?;

    let price = result
        .meta
        .regular_market_price
        .or(result.meta.previous_close)
        .ok_or_else(|| AppError::external("Yahoo: fiyat alanı boş"))?;

    Ok(StockPrice {
        symbol: s.to_string(),
        price,
        currency: result.meta.currency.unwrap_or_else(|| "USD".into()),
        previous_close: result.meta.previous_close,
    })
}

/// Stooq fallback — gün sonu kapanış. Format: stooq.com/q/d/l/?s={sym}.us&i=d&f=...
/// CSV cevap: "Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-05-09,...,293.32,..."
async fn fetch_stooq(symbol_upper: &str) -> AppResult<StockPrice> {
    // Stooq US hisseleri için lowercase + .us suffix bekliyor
    let stooq_symbol = format!("{}.us", symbol_upper.to_lowercase());
    let url = format!(
        "https://stooq.com/q/l/?s={}&f=sd2t2ohlcv&h&e=csv",
        crate::services::url::encode(&stooq_symbol)
    );
    let resp = HTTP.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!("Stooq HTTP {}", resp.status())));
    }
    let body = resp.text().await?;

    // Header satırını atla, ilk veri satırını oku
    let mut lines = body.lines();
    lines.next(); // header
    let row = lines
        .next()
        .ok_or_else(|| AppError::not_found(format!("Stooq satır yok: {symbol_upper}")))?;

    // sembol,tarih,zaman,o,h,l,close,volume
    let cols: Vec<&str> = row.split(',').collect();
    if cols.len() < 7 {
        return Err(AppError::external(format!(
            "Stooq beklenmeyen format: {row}"
        )));
    }
    // "N/D" döndüyse Stooq sembolü tanımıyor
    if cols.iter().any(|c| c.trim().eq_ignore_ascii_case("N/D")) {
        return Err(AppError::not_found(format!(
            "Stooq sembolü tanımıyor: {symbol_upper}"
        )));
    }
    let close: f64 = cols[6]
        .trim()
        .parse()
        .map_err(|e| AppError::external(format!("Stooq close parse: {e} ({})", cols[6])))?;
    let open: Option<f64> = cols[3].trim().parse().ok();

    Ok(StockPrice {
        symbol: symbol_upper.to_string(),
        price: close,
        currency: "USD".into(),
        previous_close: open, // Stooq aynı gün open — yaklaşık 24h önceki referans
    })
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    quotes: Vec<SearchQuote>,
}

#[derive(Debug, Deserialize)]
struct SearchQuote {
    symbol: String,
    #[serde(default)]
    shortname: Option<String>,
    #[serde(default)]
    longname: Option<String>,
    #[serde(default, rename = "quoteType")]
    quote_type: Option<String>,
    #[serde(default)]
    exchange: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub symbol: String,
    pub name: String,
    pub exchange: Option<String>,
    pub quote_type: Option<String>,
}

pub async fn search(query: &str) -> AppResult<Vec<SearchHit>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let url = format!(
        "https://query2.finance.yahoo.com/v1/finance/search?q={}&quotesCount=20&newsCount=0",
        crate::services::url::encode(q)
    );
    // Yahoo bazen Accept header'ı bot detection için kontrol ediyor.
    let resp = HTTP
        .get(&url)
        .header("Accept", "application/json, text/plain, */*")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", "https://finance.yahoo.com/")
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::external(format!(
            "Yahoo search HTTP {}",
            resp.status()
        )));
    }
    let body: SearchResponse = resp.json().await?;
    Ok(body
        .quotes
        .into_iter()
        // EQUITY (hisse senedi) ve ETF dışındakileri filtrele — kullanıcı
        // crypto için ayrı sekme kullanıyor, MUTUALFUND/INDEX vs. kafa karıştırır
        .filter(|q| {
            matches!(
                q.quote_type.as_deref(),
                Some("EQUITY") | Some("ETF") | None
            )
        })
        .map(|q| SearchHit {
            symbol: q.symbol,
            name: q.longname.or(q.shortname).unwrap_or_default(),
            exchange: q.exchange,
            quote_type: q.quote_type,
        })
        .collect())
}
