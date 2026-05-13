//! Frontend ile paylaşılan domain modelleri (PLAN §9).
//! sqlx::FromRow ile DB'den, Serialize ile Tauri komutlarından dönerler.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Profile {
    pub id: i64,
    pub name: String,
    pub pinned: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Portfolio {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub pinned: i64,
    pub profile_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Budget {
    pub id: i64,
    pub name: String,
    pub monthly_income: f64,
    pub monthly_expense: f64,
    /// Varsayılan entry currency (yeni entry default'u)
    pub currency: String,
    pub target_value: Option<f64>,
    pub target_date: Option<i64>,
    pub pinned: i64,
    pub created_at: i64,
    pub profile_id: Option<i64>,
    /// Hedef değerin currency'si — entry currency'sinden bağımsız
    pub target_currency: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct BudgetLine {
    pub id: i64,
    pub budget_id: i64,
    /// 'income' | 'expense'
    pub kind: String,
    pub label: String,
    pub amount: f64,
    pub currency: String,
    /// 'YYYY-MM' — line item bu aydan itibaren geçerli
    pub start_ym: String,
    /// 'YYYY-MM' nullable — NULL ise açık uçlu (sonsuza kadar)
    pub end_ym: Option<String>,
    /// start_ym ay ortası için USD kilit (reporting için, opsiyonel)
    pub fx_to_usd: Option<f64>,
    pub note: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct BudgetMonthOverride {
    pub budget_id: i64,
    pub year_month: String,
    pub interpolate: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Asset {
    pub id: i64,
    pub portfolio_id: i64,
    pub symbol: String,
    pub name: String,
    /// 'crypto' | 'stock' | 'fx' | 'commodity'
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub asset_type: String,
    pub currency: String,
    pub external_id: Option<String>,
    pub created_at: i64,
    /// Yıllık beklenen nakit akışı (% staking/temettü/faiz). Kullanıcı manuel
    /// girer veya hisseler için fetcher otomatik doldurur (TODO).
    pub expected_yield_pct: Option<f64>,
    /// Asset logosu URL'i. Kripto için CoinGecko, hisse için Clearbit-benzeri.
    pub icon_url: Option<String>,
    /// Bulunduğu platform/borsa — opsiyonel metadata (örn "Binance", "Kraken").
    pub platform: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Transaction {
    pub id: i64,
    pub asset_id: i64,
    pub date: i64,
    /// 'buy' | 'sell' | 'passive_income'
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub tx_type: String,
    /// Sadece passive_income için: 'staking' | 'dividend' | 'interest'
    pub source: Option<String>,
    pub quantity: f64,
    pub price: f64,
    pub fee: f64,
    pub note: Option<String>,
    pub is_deleted: i64,
    pub created_at: i64,
    /// 1 asset.currency = X USD, transaction.date günkü kilit oran. NULL = current FX fallback
    pub fx_to_usd: Option<f64>,
    /// Bu işlemin yapıldığı platform/borsa (opsiyonel)
    pub platform: Option<String>,
    /// Bu pozisyonun yıllık beklenen faiz/yield oranı (%). NULL = asset.expected_yield_pct fallback
    pub expected_yield_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PriceCache {
    pub asset_id: i64,
    pub price: f64,
    pub currency: String,
    pub fetched_at: i64,
    /// Son 24 saatteki yüzde değişim. None = veri yok (ilk kez çekildi veya fetcher dönmedi).
    pub change_24h_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PriceAlert {
    pub id: i64,
    pub asset_id: i64,
    /// 'above' | 'below'
    pub condition: String,
    pub threshold: f64,
    pub currency: String,
    pub active: i64,
    pub triggered_at: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Goal {
    pub id: i64,
    pub name: String,
    pub target_value: f64,
    pub currency: String,
    pub target_date: Option<i64>,
    pub achieved_at: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Setting {
    pub key: String,
    pub value: String,
}
