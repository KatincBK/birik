use tauri::State;

use crate::commands::now_secs;
use crate::db::models::Asset;
use crate::error::{AppError, AppResult};
use crate::services::Db;

const VALID_TYPES: &[&str] = &["crypto", "stock", "fx", "commodity"];

/// Asset CRUD'undan önce çağrılır — eğer ensure_columns boot'ta her hangi bir
/// nedenden çalışmadıysa burada son şans olarak gerekli sütunları kontrol et.
pub async fn ensure_asset_columns(pool: &sqlx::SqlitePool) -> AppResult<()> {
    let required: &[(&str, &str)] = &[
        ("expected_yield_pct", "REAL"),
        ("icon_url", "TEXT"),
        ("platform", "TEXT"),
    ];
    for (col, def) in required {
        let check_sql = format!(
            "SELECT 1 FROM pragma_table_info('assets') WHERE name = ?1 LIMIT 1"
        );
        let exists: Option<i64> = sqlx::query_scalar(&check_sql)
            .bind(col)
            .fetch_optional(pool)
            .await?;
        if exists.is_none() {
            let sql = format!("ALTER TABLE assets ADD COLUMN {col} {def}");
            log::warn!("[birik] runtime fix: ALTER TABLE assets ADD {col}");
            eprintln!("[birik] runtime ALTER TABLE assets ADD {col} {def}");
            sqlx::query(&sql).execute(pool).await?;
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_asset(
    db: State<'_, Db>,
    portfolio_id: i64,
    symbol: String,
    name: String,
    #[allow(non_snake_case)] r#type: String,
    currency: String,
    external_id: Option<String>,
    icon_url: Option<String>,
    expected_yield_pct: Option<f64>,
    platform: Option<String>,
) -> AppResult<Asset> {
    if !VALID_TYPES.contains(&r#type.as_str()) {
        return Err(AppError::validation(format!(
            "Geçersiz varlık tipi: {} (crypto/stock/fx/commodity olmalı)",
            r#type
        )));
    }
    let symbol = symbol.trim().to_uppercase();
    let name = name.trim().to_string();
    let currency = currency.trim().to_uppercase();

    if symbol.is_empty() || name.is_empty() {
        return Err(AppError::validation("Sembol ve isim boş olamaz"));
    }

    // Son şans schema fix
    ensure_asset_columns(&db.pool).await?;

    let now = now_secs();
    let platform = platform
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let row: Asset = sqlx::query_as(
        "INSERT INTO assets
            (portfolio_id, symbol, name, type, currency, external_id, created_at,
             expected_yield_pct, icon_url, platform)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id, portfolio_id, symbol, name, type, currency, external_id, created_at,
                   expected_yield_pct, icon_url, platform",
    )
    .bind(portfolio_id)
    .bind(&symbol)
    .bind(&name)
    .bind(&r#type)
    .bind(&currency)
    .bind(&external_id)
    .bind(now)
    .bind(expected_yield_pct)
    .bind(&icon_url)
    .bind(&platform)
    .fetch_one(&db.pool)
    .await?;
    Ok(row)
}

#[tauri::command]
pub async fn list_assets(db: State<'_, Db>, portfolio_id: i64) -> AppResult<Vec<Asset>> {
    ensure_asset_columns(&db.pool).await?;
    let rows: Vec<Asset> = sqlx::query_as(
        "SELECT id, portfolio_id, symbol, name, type, currency, external_id, created_at,
                expected_yield_pct, icon_url, platform
         FROM assets WHERE portfolio_id = ? ORDER BY symbol",
    )
    .bind(portfolio_id)
    .fetch_all(&db.pool)
    .await?;
    Ok(rows)
}

#[tauri::command]
pub async fn delete_asset(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM assets WHERE id = ?")
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Varlık bulunamadı: id={id}")));
    }
    Ok(())
}

/// Asset varsa bul, yoksa oluştur — UNIQUE(portfolio_id, symbol) çakışmasında
/// var olanı döndürür. Yeni "Varlık ekle → işlem gir" akışı bunu kullanır.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn find_or_create_asset(
    db: State<'_, Db>,
    portfolio_id: i64,
    symbol: String,
    name: String,
    #[allow(non_snake_case)] r#type: String,
    currency: String,
    external_id: Option<String>,
    icon_url: Option<String>,
    expected_yield_pct: Option<f64>,
    platform: Option<String>,
) -> AppResult<Asset> {
    let symbol_up = symbol.trim().to_uppercase();
    if symbol_up.is_empty() {
        return Err(AppError::validation("Sembol boş olamaz"));
    }

    // Son şans schema fix — kolon yoksa ekle
    ensure_asset_columns(&db.pool).await?;

    // Var mı?
    let existing: Option<Asset> = sqlx::query_as(
        "SELECT id, portfolio_id, symbol, name, type, currency, external_id, created_at,
                expected_yield_pct, icon_url, platform
         FROM assets WHERE portfolio_id = ? AND symbol = ?",
    )
    .bind(portfolio_id)
    .bind(&symbol_up)
    .fetch_optional(&db.pool)
    .await?;

    let platform_clean = platform
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if let Some(a) = existing {
        // Yield/icon/platform güncellemesi (sadece yenisi geldiyse ve mevcut null ise yaz;
        // platform geldiyse her zaman güncelle — kullanıcı bilinçli değiştirebilir)
        let need_update = (a.expected_yield_pct.is_none() && expected_yield_pct.is_some())
            || (a.icon_url.is_none() && icon_url.is_some())
            || platform_clean.is_some();
        if need_update {
            sqlx::query(
                "UPDATE assets
                 SET expected_yield_pct = COALESCE(?, expected_yield_pct),
                     icon_url = COALESCE(?, icon_url),
                     platform = COALESCE(?, platform)
                 WHERE id = ?",
            )
            .bind(expected_yield_pct)
            .bind(&icon_url)
            .bind(&platform_clean)
            .bind(a.id)
            .execute(&db.pool)
            .await?;
        }
        // Güncel hâlini geri çek
        let refreshed: Asset = sqlx::query_as(
            "SELECT id, portfolio_id, symbol, name, type, currency, external_id, created_at,
                    expected_yield_pct, icon_url, platform
             FROM assets WHERE id = ?",
        )
        .bind(a.id)
        .fetch_one(&db.pool)
        .await?;
        return Ok(refreshed);
    }

    // Yoksa oluştur (create_asset ile aynı validation)
    create_asset(
        db,
        portfolio_id,
        symbol,
        name,
        r#type,
        currency,
        external_id,
        icon_url,
        expected_yield_pct,
        platform_clean,
    )
    .await
}

/// Asset'in platform alanını güncelle (varlık detay sayfasından).
#[tauri::command]
pub async fn update_asset_platform(
    db: State<'_, Db>,
    id: i64,
    platform: Option<String>,
) -> AppResult<()> {
    ensure_asset_columns(&db.pool).await?;
    let clean = platform
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let res = sqlx::query("UPDATE assets SET platform = ? WHERE id = ?")
        .bind(&clean)
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Varlık bulunamadı: id={id}")));
    }
    Ok(())
}

/// Kullanıcının manuel girdiği yıllık beklenen yield'i güncelle.
/// `null` gönderilirse alan temizlenir.
#[tauri::command]
pub async fn update_asset_yield(
    db: State<'_, Db>,
    id: i64,
    expected_yield_pct: Option<f64>,
) -> AppResult<()> {
    if let Some(v) = expected_yield_pct {
        if !v.is_finite() || v < 0.0 || v > 1000.0 {
            return Err(AppError::validation("Beklenen yield 0-1000% arasında olmalı"));
        }
    }
    let res = sqlx::query("UPDATE assets SET expected_yield_pct = ? WHERE id = ?")
        .bind(expected_yield_pct)
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!("Varlık bulunamadı: id={id}")));
    }
    Ok(())
}
