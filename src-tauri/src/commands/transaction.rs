use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

use crate::commands::now_secs;
use crate::db::models::{Asset, Transaction};
use crate::error::{AppError, AppResult};
use crate::services::Db;

/// Bir para birimi + tarih için tarihsel USD kur lock'u.
/// Hata olursa None — display tarafı current FX ile fallback.
async fn lock_fx_for_currency(currency: &str, date: i64) -> Option<f64> {
    let ccy = currency.trim().to_uppercase();
    if ccy.is_empty() {
        return None;
    }
    if ccy == "USD" {
        return Some(1.0);
    }
    let dt = chrono::DateTime::<chrono::Utc>::from_timestamp(date, 0)?;
    let date_iso = dt.format("%Y-%m-%d").to_string();
    match crate::services::frankfurter::fetch_to_usd_at(&date_iso, &ccy).await {
        Ok(v) if v > 0.0 => Some(v),
        Ok(_) => None,
        Err(e) => {
            log::warn!("[birik] tx fx lock fail (date={date_iso}, ccy={ccy}): {e}");
            None
        }
    }
}

/// transaction.date (unix sec) ve asset.currency için tarihsel USD kur lock.
async fn lock_fx_to_usd(pool: &SqlitePool, asset_id: i64, date: i64) -> Option<f64> {
    let asset_ccy: Option<(String,)> =
        sqlx::query_as("SELECT currency FROM assets WHERE id = ?")
            .bind(asset_id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    lock_fx_for_currency(&asset_ccy?.0, date).await
}

const VALID_TYPES: &[&str] = &["buy", "sell", "passive_income"];
const VALID_ASSET_TYPES: &[&str] = &["crypto", "stock", "fx", "commodity"];
const VALID_SOURCES: &[&str] = &["staking", "dividend", "interest"];

/// PLAN §11 edge case'leri burada uygulanıyor:
/// - tarih bugünden ileri olamaz
/// - miktar > 0
/// - alış/satış için fiyat > 0 (passive_income için 0 olabilir)
fn validate(
    tx_type: &str,
    source: Option<&str>,
    quantity: f64,
    price: f64,
    date: i64,
) -> AppResult<()> {
    if !VALID_TYPES.contains(&tx_type) {
        return Err(AppError::validation(format!("Geçersiz işlem tipi: {tx_type}")));
    }
    if tx_type == "passive_income" {
        match source {
            Some(s) if VALID_SOURCES.contains(&s) => {}
            _ => {
                return Err(AppError::validation(
                    "Pasif gelir için kaynak belirtilmeli (staking/dividend/interest)",
                ))
            }
        }
    }
    if quantity <= 0.0 {
        return Err(AppError::validation("Miktar 0'dan büyük olmalı"));
    }
    if (tx_type == "buy" || tx_type == "sell") && price <= 0.0 {
        return Err(AppError::validation("Fiyat 0'dan büyük olmalı"));
    }
    if price < 0.0 {
        return Err(AppError::validation("Fiyat negatif olamaz"));
    }
    let now = now_secs();
    if date > now + 60 {
        return Err(AppError::validation("Gelecek tarihli işlem girilemez"));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_transaction(
    db: State<'_, Db>,
    asset_id: i64,
    date: i64,
    #[allow(non_snake_case)] r#type: String,
    source: Option<String>,
    quantity: f64,
    price: f64,
    fee: Option<f64>,
    note: Option<String>,
    tags: Option<Vec<String>>,
    platform: Option<String>,
    expected_yield_pct: Option<f64>,
) -> AppResult<Transaction> {
    validate(&r#type, source.as_deref(), quantity, price, date)?;
    let fee = fee.unwrap_or(0.0);
    let platform_clean = platform
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let fx_to_usd = lock_fx_to_usd(&db.pool, asset_id, date).await;

    let mut tx = db.pool.begin().await?;

    let row: Transaction = sqlx::query_as(
        "INSERT INTO transactions
            (asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform, expected_yield_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
         RETURNING id, asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform, expected_yield_pct",
    )
    .bind(asset_id)
    .bind(date)
    .bind(&r#type)
    .bind(&source)
    .bind(quantity)
    .bind(price)
    .bind(fee)
    .bind(&note)
    .bind(now_secs())
    .bind(fx_to_usd)
    .bind(&platform_clean)
    .bind(expected_yield_pct)
    .fetch_one(&mut *tx)
    .await?;

    if let Some(tag_list) = tags {
        for raw in tag_list {
            let tag = raw.trim();
            if tag.is_empty() {
                continue;
            }
            // PLAN §11: aynı etiket tekrar → sessizce ignore (PRIMARY KEY unique)
            sqlx::query(
                "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag) VALUES (?, ?)",
            )
            .bind(row.id)
            .bind(tag)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    crate::services::backup::mark_dirty();
    Ok(row)
}

#[tauri::command]
pub async fn list_transactions(
    db: State<'_, Db>,
    asset_id: i64,
    include_deleted: Option<bool>,
    tag: Option<String>,
) -> AppResult<Vec<Transaction>> {
    let include_deleted = include_deleted.unwrap_or(false);
    let tag = tag.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());

    let rows: Vec<Transaction> = match (include_deleted, tag) {
        (true, None) => {
            sqlx::query_as(
                "SELECT id, asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform, expected_yield_pct
                 FROM transactions WHERE asset_id = ? ORDER BY date DESC, id DESC",
            )
            .bind(asset_id)
            .fetch_all(&db.pool)
            .await?
        }
        (false, None) => {
            sqlx::query_as(
                "SELECT id, asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform, expected_yield_pct
                 FROM transactions WHERE asset_id = ? AND is_deleted = 0 ORDER BY date DESC, id DESC",
            )
            .bind(asset_id)
            .fetch_all(&db.pool)
            .await?
        }
        (true, Some(t)) => {
            sqlx::query_as(
                "SELECT t.id, t.asset_id, t.date, t.type, t.source, t.quantity, t.price, t.fee, t.note, t.is_deleted, t.created_at, t.fx_to_usd, t.platform, t.expected_yield_pct
                 FROM transactions t
                 INNER JOIN transaction_tags tt ON tt.transaction_id = t.id
                 WHERE t.asset_id = ? AND tt.tag = ?
                 ORDER BY t.date DESC, t.id DESC",
            )
            .bind(asset_id)
            .bind(t)
            .fetch_all(&db.pool)
            .await?
        }
        (false, Some(t)) => {
            sqlx::query_as(
                "SELECT t.id, t.asset_id, t.date, t.type, t.source, t.quantity, t.price, t.fee, t.note, t.is_deleted, t.created_at, t.fx_to_usd, t.platform, t.expected_yield_pct
                 FROM transactions t
                 INNER JOIN transaction_tags tt ON tt.transaction_id = t.id
                 WHERE t.asset_id = ? AND t.is_deleted = 0 AND tt.tag = ?
                 ORDER BY t.date DESC, t.id DESC",
            )
            .bind(asset_id)
            .bind(t)
            .fetch_all(&db.pool)
            .await?
        }
    };
    Ok(rows)
}

#[tauri::command]
pub async fn list_transaction_tags(
    db: State<'_, Db>,
    asset_id: i64,
) -> AppResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT tt.tag
         FROM transaction_tags tt
         INNER JOIN transactions t ON t.id = tt.transaction_id
         WHERE t.asset_id = ? AND t.is_deleted = 0
         ORDER BY tt.tag",
    )
    .bind(asset_id)
    .fetch_all(&db.pool)
    .await?;
    Ok(rows.into_iter().map(|t| t.0).collect())
}

/// 5sn undo penceresi için. Gerçek silme `hard_delete_transaction` ile.
#[tauri::command]
pub async fn soft_delete_transaction(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let res = sqlx::query("UPDATE transactions SET is_deleted = 1 WHERE id = ?")
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!(
            "İşlem bulunamadı: id={id}"
        )));
    }
    crate::services::backup::mark_dirty();
    Ok(())
}

#[tauri::command]
pub async fn hard_delete_transaction(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM transactions WHERE id = ?")
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!(
            "İşlem bulunamadı: id={id}"
        )));
    }
    crate::services::backup::mark_dirty();
    Ok(())
}

/// Mevcut işlemi düzenle. Tip ve asset değişmez (asset taşıma destek yok).
/// Tags param verilirse mevcut etiketler komple silinip yenisi yazılır.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn update_transaction(
    db: State<'_, Db>,
    id: i64,
    date: i64,
    quantity: f64,
    price: f64,
    fee: Option<f64>,
    note: Option<String>,
    tags: Option<Vec<String>>,
    platform: Option<String>,
    expected_yield_pct: Option<f64>,
) -> AppResult<Transaction> {
    // Mevcut tx'i bul (tip kontrolü için)
    let existing: Transaction = sqlx::query_as(
        "SELECT id, asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform, expected_yield_pct
         FROM transactions WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| AppError::not_found(format!("İşlem bulunamadı: id={id}")))?;

    // Tip-bağımlı validation (mevcut tipiyle)
    validate(
        &existing.tx_type,
        existing.source.as_deref(),
        quantity,
        price,
        date,
    )?;
    let fee = fee.unwrap_or(0.0);

    // Tarih değişmişse fx_to_usd yeniden hesapla, değişmemişse mevcut kalsın.
    let fx_to_usd = if date != existing.date {
        lock_fx_to_usd(&db.pool, existing.asset_id, date).await
    } else {
        existing.fx_to_usd
    };

    let mut tx = db.pool.begin().await?;

    let platform_clean = platform
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let updated: Transaction = sqlx::query_as(
        "UPDATE transactions
         SET date = ?, quantity = ?, price = ?, fee = ?, note = ?, fx_to_usd = ?, platform = ?, expected_yield_pct = ?
         WHERE id = ?
         RETURNING id, asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform, expected_yield_pct",
    )
    .bind(date)
    .bind(quantity)
    .bind(price)
    .bind(fee)
    .bind(&note)
    .bind(fx_to_usd)
    .bind(&platform_clean)
    .bind(expected_yield_pct)
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;

    if let Some(tag_list) = tags {
        sqlx::query("DELETE FROM transaction_tags WHERE transaction_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        for raw in tag_list {
            let tag = raw.trim();
            if tag.is_empty() {
                continue;
            }
            sqlx::query(
                "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag) VALUES (?, ?)",
            )
            .bind(id)
            .bind(tag)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    crate::services::backup::mark_dirty();
    Ok(updated)
}

/// Bir işlemin etiketlerini liste olarak getir (edit modal'ın doldurması için).
#[tauri::command]
pub async fn list_tags_of_transaction(
    db: State<'_, Db>,
    transaction_id: i64,
) -> AppResult<Vec<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT tag FROM transaction_tags WHERE transaction_id = ? ORDER BY tag")
            .bind(transaction_id)
            .fetch_all(&db.pool)
            .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

#[tauri::command]
pub async fn restore_transaction(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let res = sqlx::query("UPDATE transactions SET is_deleted = 0 WHERE id = ?")
        .bind(id)
        .execute(&db.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(format!(
            "İşlem bulunamadı: id={id}"
        )));
    }
    crate::services::backup::mark_dirty();
    Ok(())
}

// ============================================================
// Takas (swap) — çok bacaklı tek işlem
// ============================================================

/// Satılan bacak: portföyde zaten var olan bir asset'ten çıkış.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwapSellLeg {
    pub asset_id: i64,
    pub platform: Option<String>,
    pub quantity: f64,
    pub price: f64,
    pub fee: Option<f64>,
}

/// Alınan bacak: asset find-or-create + buy tx. `price` birim maliyettir
/// (frontend satılan değer / alınan miktar ile otomatik hesaplar, override edilebilir).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwapBuyLeg {
    pub symbol: String,
    pub name: String,
    pub asset_type: String,
    pub currency: String,
    pub external_id: Option<String>,
    pub icon_url: Option<String>,
    pub expected_yield_pct: Option<f64>,
    pub platform: Option<String>,
    pub quantity: f64,
    pub price: f64,
    pub fee: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct SwapResult {
    pub sell_count: usize,
    pub buy_count: usize,
}

/// Tek bir sqlx transaction içinde asset bul-veya-oluştur.
/// `commands::asset::find_or_create_asset`'in tx üzerinde çalışan kopyası —
/// takas / portföy taşıma atomikliği için pool yerine connection üzerinden gider.
#[allow(clippy::too_many_arguments)]
async fn find_or_create_asset_in_tx(
    conn: &mut sqlx::SqliteConnection,
    portfolio_id: i64,
    symbol: &str,
    name: &str,
    asset_type: &str,
    currency: &str,
    external_id: Option<&str>,
    icon_url: Option<&str>,
    expected_yield_pct: Option<f64>,
    platform: Option<&str>,
) -> AppResult<Asset> {
    let symbol_up = symbol.trim().to_uppercase();
    if symbol_up.is_empty() {
        return Err(AppError::validation("Sembol boş olamaz"));
    }
    let platform_clean = platform
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let existing: Option<Asset> = sqlx::query_as(
        "SELECT id, portfolio_id, symbol, name, type, currency, external_id, created_at,
                expected_yield_pct, icon_url, platform
         FROM assets WHERE portfolio_id = ? AND symbol = ?",
    )
    .bind(portfolio_id)
    .bind(&symbol_up)
    .fetch_optional(&mut *conn)
    .await?;

    if let Some(a) = existing {
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
            .bind(icon_url)
            .bind(&platform_clean)
            .bind(a.id)
            .execute(&mut *conn)
            .await?;
        }
        let refreshed: Asset = sqlx::query_as(
            "SELECT id, portfolio_id, symbol, name, type, currency, external_id, created_at,
                    expected_yield_pct, icon_url, platform
             FROM assets WHERE id = ?",
        )
        .bind(a.id)
        .fetch_one(&mut *conn)
        .await?;
        return Ok(refreshed);
    }

    // Yoksa oluştur
    let name_trimmed = name.trim();
    let name_final = if name_trimmed.is_empty() {
        symbol_up.as_str()
    } else {
        name_trimmed
    };
    let currency_up = currency.trim().to_uppercase();
    let currency_final = if currency_up.is_empty() {
        "USD"
    } else {
        currency_up.as_str()
    };
    let row: Asset = sqlx::query_as(
        "INSERT INTO assets
            (portfolio_id, symbol, name, type, currency, external_id, created_at,
             expected_yield_pct, icon_url, platform)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id, portfolio_id, symbol, name, type, currency, external_id, created_at,
                   expected_yield_pct, icon_url, platform",
    )
    .bind(portfolio_id)
    .bind(&symbol_up)
    .bind(name_final)
    .bind(asset_type)
    .bind(currency_final)
    .bind(external_id)
    .bind(now_secs())
    .bind(expected_yield_pct)
    .bind(icon_url)
    .bind(&platform_clean)
    .fetch_one(&mut *conn)
    .await?;
    Ok(row)
}

/// Çok bacaklı takas: N satılan + M alınan varlık tek atomik işlemde.
/// Her satılan bacak → `sell` tx, her alınan bacak → asset find-or-create + `buy` tx.
/// Herhangi bir bacak hata verirse tüm işlem geri alınır.
#[tauri::command]
pub async fn create_swap_transaction(
    db: State<'_, Db>,
    portfolio_id: i64,
    date: i64,
    sell_legs: Vec<SwapSellLeg>,
    buy_legs: Vec<SwapBuyLeg>,
    note: Option<String>,
) -> AppResult<SwapResult> {
    // --- Validation ---
    if sell_legs.is_empty() || buy_legs.is_empty() {
        return Err(AppError::validation(
            "Takas için en az bir satılan ve bir alınan varlık gerekli",
        ));
    }
    if date > now_secs() + 60 {
        return Err(AppError::validation("Gelecek tarihli işlem girilemez"));
    }
    for s in &sell_legs {
        if s.quantity <= 0.0 {
            return Err(AppError::validation("Satılan miktar 0'dan büyük olmalı"));
        }
        if s.price <= 0.0 {
            return Err(AppError::validation("Satış fiyatı 0'dan büyük olmalı"));
        }
    }
    for b in &buy_legs {
        if b.quantity <= 0.0 {
            return Err(AppError::validation("Alınan miktar 0'dan büyük olmalı"));
        }
        if b.price <= 0.0 {
            return Err(AppError::validation("Alış maliyeti 0'dan büyük olmalı"));
        }
        if b.symbol.trim().is_empty() {
            return Err(AppError::validation("Alınan varlık sembolü boş olamaz"));
        }
        if !VALID_ASSET_TYPES.contains(&b.asset_type.as_str()) {
            return Err(AppError::validation(format!(
                "Geçersiz varlık tipi: {}",
                b.asset_type
            )));
        }
    }

    // Son şans schema fix (assets kolonları)
    crate::commands::asset::ensure_asset_columns(&db.pool).await?;

    // FX lock'ları tx açmadan önce hesapla (frankfurter HTTP çağrısı).
    let mut sell_fx: Vec<Option<f64>> = Vec::with_capacity(sell_legs.len());
    for s in &sell_legs {
        sell_fx.push(lock_fx_to_usd(&db.pool, s.asset_id, date).await);
    }
    let mut buy_fx: Vec<Option<f64>> = Vec::with_capacity(buy_legs.len());
    for b in &buy_legs {
        buy_fx.push(lock_fx_for_currency(&b.currency, date).await);
    }

    let note_clean = note
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // --- Atomik transaction ---
    let mut tx = db.pool.begin().await?;

    // Satılan bacaklar → sell tx (asset portföye ait mi kontrol et).
    for (s, fx) in sell_legs.iter().zip(sell_fx.iter()) {
        let owns: Option<(i64,)> =
            sqlx::query_as("SELECT 1 FROM assets WHERE id = ? AND portfolio_id = ?")
                .bind(s.asset_id)
                .bind(portfolio_id)
                .fetch_optional(&mut *tx)
                .await?;
        if owns.is_none() {
            return Err(AppError::validation(format!(
                "Satılan varlık bu portföyde değil: asset_id={}",
                s.asset_id
            )));
        }
        let platform_clean = s
            .platform
            .as_ref()
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty());
        sqlx::query(
            "INSERT INTO transactions
                (asset_id, date, type, source, quantity, price, fee, note, is_deleted,
                 created_at, fx_to_usd, platform, expected_yield_pct)
             VALUES (?, ?, 'sell', NULL, ?, ?, ?, ?, 0, ?, ?, ?, NULL)",
        )
        .bind(s.asset_id)
        .bind(date)
        .bind(s.quantity)
        .bind(s.price)
        .bind(s.fee.unwrap_or(0.0))
        .bind(&note_clean)
        .bind(now_secs())
        .bind(*fx)
        .bind(&platform_clean)
        .execute(&mut *tx)
        .await?;
    }

    // Alınan bacaklar → asset find-or-create + buy tx.
    for (b, fx) in buy_legs.iter().zip(buy_fx.iter()) {
        let asset = find_or_create_asset_in_tx(
            &mut *tx,
            portfolio_id,
            &b.symbol,
            &b.name,
            &b.asset_type,
            &b.currency,
            b.external_id.as_deref(),
            b.icon_url.as_deref(),
            b.expected_yield_pct,
            b.platform.as_deref(),
        )
        .await?;
        let platform_clean = b
            .platform
            .as_ref()
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty());
        sqlx::query(
            "INSERT INTO transactions
                (asset_id, date, type, source, quantity, price, fee, note, is_deleted,
                 created_at, fx_to_usd, platform, expected_yield_pct)
             VALUES (?, ?, 'buy', NULL, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
        )
        .bind(asset.id)
        .bind(date)
        .bind(b.quantity)
        .bind(b.price)
        .bind(b.fee.unwrap_or(0.0))
        .bind(&note_clean)
        .bind(now_secs())
        .bind(*fx)
        .bind(&platform_clean)
        .bind(b.expected_yield_pct)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    crate::services::backup::mark_dirty();

    Ok(SwapResult {
        sell_count: sell_legs.len(),
        buy_count: buy_legs.len(),
    })
}

// ============================================================
// Portföyler arası taşıma
// ============================================================

#[derive(Debug, Serialize)]
pub struct MoveResult {
    /// "trade" | "transfer"
    pub mode: String,
    /// true = tüm bakiye, gerçek kayıtlar taşındı (yalnızca transfer modunda)
    pub full_transfer: bool,
    pub moved_quantity: f64,
    /// Kaynak varlık bu işlemden sonra boşaldı mı (listeden düşer)
    pub source_emptied: bool,
}

/// Bir varlığı başka bir portföye taşı.
///
/// - `mode = "transfer"` + tüm bakiye → kaynağın tüm işlem kayıtları
///   (orijinal tarih/fiyat/platform) hedef varlığa taşınır; kaynak varlık silinir
///   (ya da hedefte yoksa portfolio_id güncellenir). Kâr/zarar oluşmaz.
/// - `mode = "transfer"` + kısmi → bugün tarihli, **ortalama maliyetten**
///   bir satış (kaynak) + alış (hedef) çifti. Kâr/zarar oluşmaz, maliyet korunur.
/// - `mode = "trade"` → bugün tarihli, **güncel fiyattan** satış + alış çifti.
///   Kaynakta kâr/zarar gerçekleşir, hedefte yeni maliyet bazı oluşur.
#[tauri::command]
pub async fn move_asset_to_portfolio(
    db: State<'_, Db>,
    asset_id: i64,
    dest_portfolio_id: i64,
    quantity: f64,
    mode: String,
    price: Option<f64>,
) -> AppResult<MoveResult> {
    if mode != "trade" && mode != "transfer" {
        return Err(AppError::validation("Geçersiz taşıma modu"));
    }
    if quantity <= 0.0 {
        return Err(AppError::validation("Miktar 0'dan büyük olmalı"));
    }

    crate::commands::asset::ensure_asset_columns(&db.pool).await?;

    // Kaynak varlık
    let source: Asset = sqlx::query_as(
        "SELECT id, portfolio_id, symbol, name, type, currency, external_id, created_at,
                expected_yield_pct, icon_url, platform
         FROM assets WHERE id = ?",
    )
    .bind(asset_id)
    .fetch_optional(&db.pool)
    .await?
    .ok_or_else(|| AppError::not_found(format!("Varlık bulunamadı: id={asset_id}")))?;

    if source.portfolio_id == dest_portfolio_id {
        return Err(AppError::validation("Kaynak ve hedef portföy aynı olamaz"));
    }
    let dest_exists: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM portfolios WHERE id = ?")
            .bind(dest_portfolio_id)
            .fetch_optional(&db.pool)
            .await?;
    if dest_exists.is_none() {
        return Err(AppError::not_found("Hedef portföy bulunamadı"));
    }

    // Pozisyon — balance + ortalama maliyet
    let txns: Vec<Transaction> = sqlx::query_as(
        "SELECT id, asset_id, date, type, source, quantity, price, fee, note, is_deleted,
                created_at, fx_to_usd, platform, expected_yield_pct
         FROM transactions WHERE asset_id = ?",
    )
    .bind(asset_id)
    .fetch_all(&db.pool)
    .await?;
    let pos = crate::commands::calc::position_from_transactions(&txns);

    if pos.balance <= 1e-9 {
        return Err(AppError::validation("Taşınacak bakiye yok"));
    }
    if quantity > pos.balance + 1e-9 {
        return Err(AppError::validation(format!(
            "Yetersiz bakiye — mevcut {}",
            pos.balance
        )));
    }
    let is_full = quantity >= pos.balance - 1e-9;
    let now = now_secs();

    // ---- TAM TRANSFER: gerçek kayıtları taşı ----
    if mode == "transfer" && is_full {
        let mut tx = db.pool.begin().await?;
        let dest_existing: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM assets WHERE portfolio_id = ? AND symbol = ?",
        )
        .bind(dest_portfolio_id)
        .bind(&source.symbol)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some((dest_id,)) = dest_existing {
            // Hedefte aynı sembol var → kayıtları+alarmları taşı, kaynağı sil
            sqlx::query("UPDATE transactions SET asset_id = ? WHERE asset_id = ?")
                .bind(dest_id)
                .bind(asset_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query("UPDATE price_alerts SET asset_id = ? WHERE asset_id = ?")
                .bind(dest_id)
                .bind(asset_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query("DELETE FROM assets WHERE id = ?")
                .bind(asset_id)
                .execute(&mut *tx)
                .await?;
        } else {
            // Hedefte yok → varlığı direkt taşı (geçmiş, alarm, cache hepsi gelir)
            sqlx::query("UPDATE assets SET portfolio_id = ? WHERE id = ?")
                .bind(dest_portfolio_id)
                .bind(asset_id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        crate::services::backup::mark_dirty();
        return Ok(MoveResult {
            mode,
            full_transfer: true,
            moved_quantity: pos.balance,
            source_emptied: true,
        });
    }

    // ---- KISMİ TRANSFER veya TİCARET: sell + buy çifti ----
    let unit_price: f64 = if mode == "transfer" {
        if pos.avg_cost <= 0.0 {
            return Err(AppError::validation(
                "Ortalama maliyet hesaplanamadı — transfer yapılamıyor",
            ));
        }
        pos.avg_cost
    } else {
        match price {
            Some(p) if p > 0.0 => p,
            _ => {
                let cached: Option<(f64,)> =
                    sqlx::query_as("SELECT price FROM price_cache WHERE asset_id = ?")
                        .bind(asset_id)
                        .fetch_optional(&db.pool)
                        .await?;
                match cached {
                    Some((p,)) if p > 0.0 => p,
                    _ => {
                        return Err(AppError::validation(
                            "Güncel fiyat bulunamadı — ticaret için fiyat gerekli",
                        ))
                    }
                }
            }
        }
    };

    let fx = lock_fx_for_currency(&source.currency, now).await;
    let platform_clean = source
        .platform
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let note = if mode == "transfer" {
        "Portföyler arası transfer"
    } else {
        "Portföyler arası ticaret"
    };

    let mut tx = db.pool.begin().await?;

    // Kaynaktan çıkış (satış)
    sqlx::query(
        "INSERT INTO transactions
            (asset_id, date, type, source, quantity, price, fee, note, is_deleted,
             created_at, fx_to_usd, platform, expected_yield_pct)
         VALUES (?, ?, 'sell', NULL, ?, ?, 0, ?, 0, ?, ?, ?, NULL)",
    )
    .bind(asset_id)
    .bind(now)
    .bind(quantity)
    .bind(unit_price)
    .bind(note)
    .bind(now)
    .bind(fx)
    .bind(&platform_clean)
    .execute(&mut *tx)
    .await?;

    // Hedefe giriş (alış) — asset bul-veya-oluştur
    let dest_asset = find_or_create_asset_in_tx(
        &mut *tx,
        dest_portfolio_id,
        &source.symbol,
        &source.name,
        &source.asset_type,
        &source.currency,
        source.external_id.as_deref(),
        source.icon_url.as_deref(),
        source.expected_yield_pct,
        platform_clean.as_deref(),
    )
    .await?;

    sqlx::query(
        "INSERT INTO transactions
            (asset_id, date, type, source, quantity, price, fee, note, is_deleted,
             created_at, fx_to_usd, platform, expected_yield_pct)
         VALUES (?, ?, 'buy', NULL, ?, ?, 0, ?, 0, ?, ?, ?, ?)",
    )
    .bind(dest_asset.id)
    .bind(now)
    .bind(quantity)
    .bind(unit_price)
    .bind(note)
    .bind(now)
    .bind(fx)
    .bind(&platform_clean)
    .bind(source.expected_yield_pct)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    crate::services::backup::mark_dirty();

    Ok(MoveResult {
        mode,
        full_transfer: false,
        moved_quantity: quantity,
        source_emptied: is_full,
    })
}
