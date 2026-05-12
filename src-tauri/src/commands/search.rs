use serde::Serialize;
use std::collections::HashSet;
use tauri::State;

use crate::error::AppResult;
use crate::services::{coingecko, finnhub, frankfurter, yahoo, Db};

/// Frankfurter unreachable iken bile gözükecek temel para birimleri.
/// Liste Frankfurter dönerse onunla ezilir / üzerine eklenir.
const FALLBACK_CURRENCIES: &[(&str, &str)] = &[
    ("USD", "United States Dollar"),
    ("EUR", "Euro"),
    ("TRY", "Turkish Lira"),
    ("GBP", "British Pound"),
    ("CHF", "Swiss Franc"),
    ("JPY", "Japanese Yen"),
    ("CNY", "Chinese Yuan"),
    ("CAD", "Canadian Dollar"),
    ("AUD", "Australian Dollar"),
    ("NZD", "New Zealand Dollar"),
    ("SEK", "Swedish Krona"),
    ("NOK", "Norwegian Krone"),
    ("DKK", "Danish Krone"),
    ("PLN", "Polish Złoty"),
    ("CZK", "Czech Koruna"),
    ("HUF", "Hungarian Forint"),
    ("RUB", "Russian Ruble"),
    ("AED", "UAE Dirham"),
    ("SAR", "Saudi Riyal"),
    ("HKD", "Hong Kong Dollar"),
    ("SGD", "Singapore Dollar"),
    ("KRW", "South Korean Won"),
    ("INR", "Indian Rupee"),
    ("BRL", "Brazilian Real"),
    ("MXN", "Mexican Peso"),
    ("ZAR", "South African Rand"),
];

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub external_id: String,
    pub symbol: String,
    pub name: String,
    pub icon: Option<String>,
    pub asset_type: String, // "crypto" | "stock" | "fx" | "commodity"
    pub exchange: Option<String>,
}

#[tauri::command]
pub async fn search_symbol(
    db: State<'_, Db>,
    query: String,
    asset_type: String,
) -> AppResult<Vec<SearchResult>> {
    match asset_type.as_str() {
        "crypto" => {
            let hits = coingecko::search(&query).await?;
            Ok(hits
                .into_iter()
                .map(|h| SearchResult {
                    external_id: h.external_id,
                    symbol: h.symbol,
                    name: h.name,
                    icon: h.icon,
                    asset_type: "crypto".into(),
                    exchange: None,
                })
                .collect())
        }
        "stock" => {
            // Finnhub + Yahoo paralel — her ikisi de query'lenir, sonuçlar
            // sembol bazında dedupe edilir (Finnhub öncelikli, Yahoo
            // tamamlayıcı). Finnhub key yoksa sadece Yahoo.
            let key = crate::commands::setting::get_setting_value(&db.pool, "finnhub_api_key")
                .await
                .ok()
                .flatten()
                .filter(|s| !s.trim().is_empty());

            let yahoo_fut = yahoo::search(&query);
            let mut finnhub_hits: Vec<finnhub::SearchHit> = Vec::new();
            if let Some(k) = key {
                if let Ok(h) = finnhub::search(&query, &k).await {
                    finnhub_hits = h;
                }
            }
            let yahoo_hits = yahoo_fut.await.unwrap_or_default();

            let mut seen: HashSet<String> = HashSet::new();
            let mut out: Vec<SearchResult> = Vec::new();

            // Finnhub ilk
            for h in finnhub_hits {
                let sym_up = h.symbol.to_uppercase();
                if !seen.insert(sym_up.clone()) {
                    continue;
                }
                out.push(SearchResult {
                    external_id: h.symbol.clone(),
                    symbol: h.symbol,
                    name: h.name,
                    icon: None,
                    asset_type: "stock".into(),
                    exchange: h.item_type,
                });
            }

            // Yahoo ile tamamla
            for h in yahoo_hits {
                let sym_up = h.symbol.to_uppercase();
                if !seen.insert(sym_up.clone()) {
                    continue;
                }
                out.push(SearchResult {
                    external_id: h.symbol.clone(),
                    symbol: h.symbol,
                    name: h.name,
                    icon: None,
                    asset_type: "stock".into(),
                    exchange: h.exchange,
                });
            }

            Ok(out.into_iter().take(25).collect())
        }
        "commodity" => {
            // Emtia kataloğu = Frankfurter para birimleri (fx) + sabit
            // kıymetli metal listesi (commodity). Tek dropdown'da birleşik
            // gösteriliyor.
            let q_up = query.trim().to_uppercase();

            // 1) Frankfurter currency listesi (cache'li). Başarısızsa
            //    hardcoded fallback (en yaygın 20+ para birimi).
            let mut currencies = match frankfurter::list_supported_currencies().await {
                Ok(v) if !v.is_empty() => v,
                other => {
                    if let Err(e) = &other {
                        eprintln!("[birik] frankfurter /currencies fail: {e}");
                    }
                    FALLBACK_CURRENCIES
                        .iter()
                        .map(|(c, n)| (c.to_string(), n.to_string()))
                        .collect()
                }
            };
            // TRY garanti olsun (Frankfurter listesinde varsa zaten geliyor;
            // yine de paranoid emniyet).
            if !currencies.iter().any(|(c, _)| c == "TRY") {
                currencies.push(("TRY".into(), "Turkish Lira".into()));
            }
            currencies.sort_by(|a, b| a.0.cmp(&b.0));
            let mut out: Vec<SearchResult> = Vec::new();
            for (code, full_name) in currencies {
                // "TRY" gibi internal-only kullanım currency'leri de listede
                // dursun — kullanıcı her şeyi ekleyebilsin.
                let sym_up = code.to_uppercase();
                let name_up = full_name.to_uppercase();
                if q_up.is_empty()
                    || sym_up.contains(&q_up)
                    || name_up.contains(&q_up)
                {
                    out.push(SearchResult {
                        external_id: code.clone(),
                        symbol: code,
                        name: full_name,
                        icon: None,
                        asset_type: "fx".into(),
                        exchange: None,
                    });
                }
            }

            // 2) Kıymetli metaller — sabit liste. Yahoo futures sembolleri.
            const METALS: &[(&str, &str, &str)] = &[
                ("XAU", "Altın (Ons)", "GC=F"),
                ("XAG", "Gümüş (Ons)", "SI=F"),
                ("XPT", "Platin", "PL=F"),
                ("XPD", "Paladyum", "PA=F"),
            ];
            for (sym, name, yahoo_sym) in METALS {
                let sym_up = sym.to_uppercase();
                let name_up = name.to_uppercase();
                if q_up.is_empty()
                    || sym_up.contains(&q_up)
                    || name_up.contains(&q_up)
                {
                    out.push(SearchResult {
                        external_id: yahoo_sym.to_string(),
                        symbol: sym.to_string(),
                        name: name.to_string(),
                        icon: None,
                        asset_type: "commodity".into(),
                        exchange: Some("COMEX".into()),
                    });
                }
            }

            Ok(out)
        }
        _ => Ok(vec![]),
    }
}
