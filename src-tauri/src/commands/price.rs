use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

use crate::db::models::{Asset, PriceCache};
use crate::error::{AppError, AppResult};
use crate::services::{binance_rest, cache, coingecko, finnhub, tcmb, yahoo, Db};

/// Frontend'e dönen sade fiyat sonucu — kaynak ve cache hit bilgisi de var.
#[derive(Debug, Clone, Serialize)]
pub struct PriceResult {
    pub price: f64,
    pub currency: String,
    pub source: String, // "coingecko" | "yahoo" | "tcmb"
    pub cache_hit: bool,
    pub fetched_at: i64,
    /// Son 24 saatte yüzde değişim (None: bilinmiyor)
    pub change_24h_pct: Option<f64>,
}

/// Kripto fiyatı — frontend doğrudan çağırırsa.
/// `coingecko_id` bizim tarihsel paramız; sembol türetmesini de destekler.
#[tauri::command]
pub async fn fetch_crypto_price(coingecko_id: String) -> AppResult<coingecko::CryptoPrice> {
    coingecko::fetch_price(&coingecko_id).await
}

#[tauri::command]
pub async fn fetch_stock_price_yahoo(
    db: State<'_, Db>,
    symbol: String,
) -> AppResult<yahoo::StockPrice> {
    // Finnhub key varsa onu dene, başarısızsa Yahoo'ya düş.
    let key = crate::commands::setting::get_setting_value(&db.pool, "finnhub_api_key")
        .await
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty());
    if let Some(k) = key {
        if let Ok(q) = finnhub::fetch_quote(&symbol, &k).await {
            return Ok(yahoo::StockPrice {
                symbol: q.symbol,
                price: q.price,
                currency: "USD".into(),
                previous_close: q.previous_close,
            });
        }
    }
    yahoo::fetch_price(&symbol).await
}

#[tauri::command]
pub async fn fetch_fx_rates() -> AppResult<tcmb::FxRates> {
    crate::services::fx::fetch_rates().await
}

/// Asset bazında cache'lenmiş fiyat. Yoksa None.
#[tauri::command]
pub async fn get_cached_price(
    db: State<'_, Db>,
    asset_id: i64,
) -> AppResult<Option<PriceCache>> {
    cache::get(&db.pool, asset_id).await
}

/// PLAN §10: refresh_all_prices(portfolio_id)
///
/// Portföydeki her asset için cache'e bak (5 dk TTL); fresh ise API'ye gitme,
/// değilse fetch et + cache'e yaz. Sonuç: asset_id → {price, currency, cache_hit}.
///
/// Cache hit log'u acceptance kriteri için console'a basılır.
#[tauri::command]
pub async fn refresh_all_prices(
    db: State<'_, Db>,
    portfolio_id: i64,
    force: Option<bool>,
) -> AppResult<HashMap<i64, PriceResult>> {
    let force = force.unwrap_or(false);

    let assets: Vec<Asset> = sqlx::query_as(
        "SELECT id, portfolio_id, symbol, name, type, currency, external_id, created_at,
                expected_yield_pct, icon_url, platform
         FROM assets WHERE portfolio_id = ?",
    )
    .bind(portfolio_id)
    .fetch_all(&db.pool)
    .await?;

    let mut out = HashMap::with_capacity(assets.len());

    // FX rates'i bir kez çek, döviz/altın asset'lerinde reuse et
    let mut fx: Option<tcmb::FxRates> = None;

    // Finnhub key — bir kez oku, hisse case'inde reuse et
    let finnhub_key =
        crate::commands::setting::get_setting_value(&db.pool, "finnhub_api_key")
            .await
            .ok()
            .flatten()
            .filter(|s| !s.trim().is_empty());

    for asset in assets {
        // Cache check
        if !force {
            if let Some(c) = cache::get(&db.pool, asset.id).await? {
                if cache::is_fresh(&c) {
                    log::info!(
                        "[birik] cache HIT  asset_id={} symbol={} (age {}s)",
                        asset.id,
                        asset.symbol,
                        crate::commands::now_secs() - c.fetched_at
                    );
                    out.insert(
                        asset.id,
                        PriceResult {
                            price: c.price,
                            currency: c.currency,
                            source: "cache".into(),
                            cache_hit: true,
                            fetched_at: c.fetched_at,
                            change_24h_pct: c.change_24h_pct,
                        },
                    );
                    continue;
                }
            }
        }

        log::info!(
            "[birik] cache MISS asset_id={} symbol={} type={}",
            asset.id,
            asset.symbol,
            asset.asset_type
        );

        let p: PriceResult = match asset.asset_type.as_str() {
            "crypto" => {
                // Binance REST → CoinGecko fallback (rate limit dostu)
                match binance_rest::fetch_quote(&asset.symbol).await {
                    Ok(q) => PriceResult {
                        price: q.usd_price,
                        currency: "USD".into(),
                        source: "binance".into(),
                        cache_hit: false,
                        fetched_at: crate::commands::now_secs(),
                        change_24h_pct: q.change_24h_pct,
                    },
                    Err(binance_err) => {
                        let id =
                            asset.external_id.as_deref().unwrap_or(asset.symbol.as_str());
                        match coingecko::fetch_price(id).await {
                            Ok(r) => PriceResult {
                                price: r.usd,
                                currency: "USD".into(),
                                source: "coingecko".into(),
                                cache_hit: false,
                                fetched_at: crate::commands::now_secs(),
                                change_24h_pct: r.usd_24h_change,
                            },
                            Err(cg_err) => {
                                // Son fallback: Yahoo'da kripto'lar `<SYM>-USD`
                                // formatında tutuluyor (örn HYPE-USD, BTC-USD).
                                // Binance'te olmayan yeni token'lar için
                                // hayat kurtarıyor.
                                let y_sym = format!("{}-USD", asset.symbol.to_uppercase());
                                match yahoo::fetch_price(&y_sym).await {
                                    Ok(r) => {
                                        let pct = match r.previous_close {
                                            Some(prev) if prev > 0.0 => {
                                                Some((r.price - prev) / prev * 100.0)
                                            }
                                            _ => None,
                                        };
                                        PriceResult {
                                            price: r.price,
                                            currency: "USD".into(),
                                            source: "yahoo".into(),
                                            cache_hit: false,
                                            fetched_at: crate::commands::now_secs(),
                                            change_24h_pct: pct,
                                        }
                                    }
                                    Err(y_err) => {
                                        return Err(AppError::external(format!(
                                            "Binance + CoinGecko + Yahoo üçü de fail ({}). Binance: {}; CoinGecko: {}; Yahoo: {}",
                                            asset.symbol, binance_err, cg_err, y_err
                                        )));
                                    }
                                }
                            }
                        }
                    }
                }
            }
            "stock" => {
                let symbol = asset.external_id.as_deref().unwrap_or(asset.symbol.as_str());
                // Finnhub key varsa onu önce dene
                if let Some(k) = finnhub_key.as_deref() {
                    match finnhub::fetch_quote(symbol, k).await {
                        Ok(q) => PriceResult {
                            price: q.price,
                            currency: "USD".into(),
                            source: "finnhub".into(),
                            cache_hit: false,
                            fetched_at: crate::commands::now_secs(),
                            change_24h_pct: q.change_24h_pct,
                        },
                        Err(_) => {
                            // Finnhub fail → Yahoo fallback
                            let r = yahoo::fetch_price(symbol).await.map_err(|e| {
                                AppError::external(format!(
                                    "Finnhub+Yahoo {} her ikisi başarısız: {}",
                                    asset.symbol, e
                                ))
                            })?;
                            let pct = match r.previous_close {
                                Some(prev) if prev > 0.0 => {
                                    Some((r.price - prev) / prev * 100.0)
                                }
                                _ => None,
                            };
                            PriceResult {
                                price: r.price,
                                currency: r.currency,
                                source: "yahoo".into(),
                                cache_hit: false,
                                fetched_at: crate::commands::now_secs(),
                                change_24h_pct: pct,
                            }
                        }
                    }
                } else {
                    let r = yahoo::fetch_price(symbol).await.map_err(|e| {
                        AppError::external(format!("Yahoo {}: {}", asset.symbol, e))
                    })?;
                    let pct = match r.previous_close {
                        Some(prev) if prev > 0.0 => Some((r.price - prev) / prev * 100.0),
                        _ => None,
                    };
                    PriceResult {
                        price: r.price,
                        currency: r.currency,
                        source: "yahoo".into(),
                        cache_hit: false,
                        fetched_at: crate::commands::now_secs(),
                        change_24h_pct: pct,
                    }
                }
            }
            "commodity" => {
                // Önce Yahoo (kıymetli metaller için futures sembol — search'te
                // external_id'ye yazılır: GC=F, SI=F, PL=F, PA=F). external_id
                // yoksa veya Yahoo başarısızsa TCMB'ye düş (XAU için).
                let yahoo_sym = asset.external_id.as_deref().filter(|s| !s.is_empty());
                let mut got: Option<PriceResult> = None;
                if let Some(ys) = yahoo_sym {
                    if let Ok(r) = yahoo::fetch_price(ys).await {
                        let pct = match r.previous_close {
                            Some(prev) if prev > 0.0 => Some((r.price - prev) / prev * 100.0),
                            _ => None,
                        };
                        got = Some(PriceResult {
                            price: r.price,
                            currency: r.currency, // futures sembolleri USD döner
                            source: "yahoo".into(),
                            cache_hit: false,
                            fetched_at: crate::commands::now_secs(),
                            change_24h_pct: pct,
                        });
                    }
                }
                if got.is_none() {
                    // TCMB fallback — XAU gram altın için çalışır
                    if fx.is_none() {
                        fx = Some(crate::services::fx::fetch_rates().await?);
                    }
                    let rates = &fx.as_ref().unwrap().rates;
                    let v = rates.get(&asset.symbol.to_uppercase()).copied().ok_or_else(|| {
                        AppError::not_found(format!(
                            "{} için fiyat bulunamadı (Yahoo + TCMB)",
                            asset.symbol
                        ))
                    })?;
                    got = Some(PriceResult {
                        price: v,
                        currency: "TRY".into(),
                        source: "tcmb".into(),
                        cache_hit: false,
                        fetched_at: crate::commands::now_secs(),
                        change_24h_pct: None,
                    });
                }
                got.unwrap()
            }
            "fx" => {
                if fx.is_none() {
                    fx = Some(crate::services::fx::fetch_rates().await?);
                }
                let rates = &fx.as_ref().unwrap().rates;
                let v = rates.get(&asset.symbol.to_uppercase()).copied().ok_or_else(|| {
                    AppError::not_found(format!(
                        "TCMB'de bulunamadı: {} (geçerli kodlar: USD, EUR, GBP, XAU…)",
                        asset.symbol
                    ))
                })?;
                PriceResult {
                    price: v,
                    currency: "TRY".into(),
                    source: "tcmb".into(),
                    cache_hit: false,
                    fetched_at: crate::commands::now_secs(),
                    change_24h_pct: None, // TCMB günlük; gün içi % değişim yok
                }
            }
            other => {
                return Err(AppError::validation(format!(
                    "Bilinmeyen varlık tipi: {other}"
                )));
            }
        };

        cache::put(&db.pool, asset.id, p.price, &p.currency, p.change_24h_pct).await?;
        out.insert(asset.id, p);
    }

    Ok(out)
}
