use serde::Serialize;
use std::collections::HashSet;
use tauri::State;

use crate::error::AppResult;
use crate::services::{coingecko, finnhub, yahoo, Db};

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
        _ => Ok(vec![]),
    }
}
