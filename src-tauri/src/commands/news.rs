use serde::Serialize;
use tauri::State;

use crate::error::AppResult;
use crate::services::{finnhub, Db};

#[derive(Debug, Clone, Serialize)]
pub struct NewsBundle {
    pub asset_symbol: String,
    pub asset_name: String,
    pub asset_type: String,
    pub icon_url: Option<String>,
    pub items: Vec<finnhub::AssetNews>,
}

/// Tüm portföylerdeki hisse asset'leri için son 7 günün haberlerini topla.
/// Finnhub key yoksa boş vec döner (graceful).
#[tauri::command]
pub async fn fetch_news_for_portfolios(
    db: State<'_, Db>,
    profile_id: Option<i64>,
) -> AppResult<Vec<NewsBundle>> {
    let key = crate::commands::setting::get_setting_value(&db.pool, "finnhub_api_key")
        .await?
        .filter(|s| !s.trim().is_empty());
    let Some(key) = key else {
        return Ok(vec![]);
    };

    #[derive(sqlx::FromRow)]
    struct AssetRow {
        symbol: String,
        name: String,
        external_id: Option<String>,
        icon_url: Option<String>,
        asset_type: String,
    }

    let rows: Vec<AssetRow> = match profile_id {
        Some(pid) => {
            sqlx::query_as(
                "SELECT DISTINCT a.symbol, a.name, a.external_id, a.icon_url,
                        a.type as asset_type
                 FROM assets a
                 JOIN portfolios p ON p.id = a.portfolio_id
                 WHERE p.profile_id = ? AND a.type = 'stock'
                 LIMIT 8",
            )
            .bind(pid)
            .fetch_all(&db.pool)
            .await?
        }
        None => {
            sqlx::query_as(
                "SELECT DISTINCT symbol, name, external_id, icon_url,
                        type as asset_type
                 FROM assets WHERE type = 'stock'
                 LIMIT 8",
            )
            .fetch_all(&db.pool)
            .await?
        }
    };

    let now = chrono::Utc::now();
    let from = (now - chrono::Duration::days(7)).format("%Y-%m-%d").to_string();
    let to = now.format("%Y-%m-%d").to_string();

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let sym = r.external_id.as_deref().unwrap_or(r.symbol.as_str());
        if let Ok(items) = finnhub::company_news(sym, &key, &from, &to).await {
            if !items.is_empty() {
                out.push(NewsBundle {
                    asset_symbol: r.symbol,
                    asset_name: r.name,
                    asset_type: r.asset_type,
                    icon_url: r.icon_url,
                    items: items.into_iter().take(3).collect(),
                });
            }
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct CompanyProfileResult {
    pub name: Option<String>,
    pub logo: Option<String>,
    pub dividend_yield_pct: Option<f64>,
}

/// AddAsset akışında stock seçilince çağrılır — temettü yield'i otomatik
/// dolar. Finnhub key yoksa Ok(empty profile) döner.
#[tauri::command]
pub async fn fetch_stock_profile(
    db: State<'_, Db>,
    symbol: String,
) -> AppResult<CompanyProfileResult> {
    let key = crate::commands::setting::get_setting_value(&db.pool, "finnhub_api_key")
        .await?
        .filter(|s| !s.trim().is_empty());
    let Some(key) = key else {
        return Ok(CompanyProfileResult {
            name: None,
            logo: None,
            dividend_yield_pct: None,
        });
    };
    match finnhub::company_profile(&symbol, &key).await {
        Ok(p) => Ok(CompanyProfileResult {
            name: p.name,
            logo: p.logo,
            dividend_yield_pct: p.dividend_yield_pct,
        }),
        Err(_) => Ok(CompanyProfileResult {
            name: None,
            logo: None,
            dividend_yield_pct: None,
        }),
    }
}
