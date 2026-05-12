//! Yedekleme + import komutları — PLAN §10 + §12 Faz 7.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::db::models::{
    Asset, Budget, BudgetEntry, Goal, PriceAlert, PriceCache, Portfolio, Profile, Setting,
    Transaction,
};
use crate::error::{AppError, AppResult};
use crate::services::{self, Db};

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportPayload {
    pub schema_version: i64,
    pub exported_at: i64,
    #[serde(default)]
    pub profiles: Vec<Profile>,
    pub portfolios: Vec<Portfolio>,
    pub assets: Vec<Asset>,
    pub transactions: Vec<Transaction>,
    pub transaction_tags: Vec<TransactionTag>,
    pub price_cache: Vec<PriceCache>,
    pub price_alerts: Vec<PriceAlert>,
    pub goals: Vec<Goal>,
    pub settings: Vec<Setting>,
    #[serde(default)]
    pub budgets: Vec<Budget>,
    #[serde(default)]
    pub budget_entries: Vec<BudgetEntry>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct TransactionTag {
    pub transaction_id: i64,
    pub tag: String,
}

/// Tüm tabloları payload'a sığdır — backup file'ı ve `export_data`
/// command'ı buradan beslenir.
pub async fn build_export_payload(pool: &SqlitePool) -> AppResult<ExportPayload> {
    let schema_version: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations WHERE success = 1",
    )
    .fetch_one(pool)
    .await?;

    let profiles: Vec<Profile> = sqlx::query_as(
        "SELECT id, name, pinned, created_at FROM profiles",
    )
    .fetch_all(pool)
    .await?;
    let portfolios: Vec<Portfolio> = sqlx::query_as(
        "SELECT id, name, created_at, pinned, profile_id FROM portfolios",
    )
    .fetch_all(pool)
    .await?;
    let budgets: Vec<Budget> = sqlx::query_as(
        "SELECT id, name, monthly_income, monthly_expense, currency,
                target_value, target_date, pinned, created_at, profile_id, target_currency
         FROM budgets",
    )
    .fetch_all(pool)
    .await?;
    let budget_entries: Vec<BudgetEntry> = sqlx::query_as(
        "SELECT budget_id, year_month, income, expense, note, recorded_at, currency, fx_to_usd
         FROM budget_entries",
    )
    .fetch_all(pool)
    .await?;
    let assets: Vec<Asset> = sqlx::query_as(
        "SELECT id, portfolio_id, symbol, name, type, currency, external_id, created_at,
                expected_yield_pct, icon_url, platform
         FROM assets",
    )
    .fetch_all(pool)
    .await?;
    let transactions: Vec<Transaction> = sqlx::query_as(
        "SELECT id, asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform, expected_yield_pct
         FROM transactions",
    )
    .fetch_all(pool)
    .await?;
    let transaction_tags: Vec<TransactionTag> =
        sqlx::query_as("SELECT transaction_id, tag FROM transaction_tags")
            .fetch_all(pool)
            .await?;
    let price_cache: Vec<PriceCache> =
        sqlx::query_as("SELECT asset_id, price, currency, fetched_at FROM price_cache")
            .fetch_all(pool)
            .await?;
    let price_alerts: Vec<PriceAlert> = sqlx::query_as(
        "SELECT id, asset_id, condition, threshold, currency, active, triggered_at, created_at
         FROM price_alerts",
    )
    .fetch_all(pool)
    .await?;
    let goals: Vec<Goal> = sqlx::query_as(
        "SELECT id, name, target_value, currency, target_date, achieved_at, created_at FROM goals",
    )
    .fetch_all(pool)
    .await?;
    let settings: Vec<Setting> = sqlx::query_as("SELECT key, value FROM settings")
        .fetch_all(pool)
        .await?;

    Ok(ExportPayload {
        schema_version,
        exported_at: crate::commands::now_secs(),
        profiles,
        portfolios,
        assets,
        transactions,
        transaction_tags,
        price_cache,
        price_alerts,
        goals,
        settings,
        budgets,
        budget_entries,
    })
}

#[tauri::command]
pub async fn export_data(db: State<'_, Db>) -> AppResult<String> {
    let payload = build_export_payload(&db.pool).await?;
    Ok(serde_json::to_string_pretty(&payload)?)
}

/// Manuel backup tetikleyici. AppData/com.birik.app/backups/birik-yyyy-mm-dd-HHMMSS.json yazar
/// ve dosya path'ini döner. 7-günlük rotasyon otomatik uygulanır.
#[tauri::command]
pub async fn trigger_backup(app: AppHandle, db: State<'_, Db>) -> AppResult<String> {
    let path = services::backup::write_backup(&app, &db.pool)
        .await
        .map_err(|e| AppError::external(format!("backup yazılamadı: {e}")))?;
    Ok(path.to_string_lossy().to_string())
}

/// PLAN §10: import_data(json, mode)
///
///   replace: tüm kullanıcı verilerini sil + import'tan yerleştir
///   merge:   var olan portföy/asset isimlerini koru, eşleşmeyenleri ekle
///
/// Settings hep replace olur (sade tek-key map).
#[tauri::command]
pub async fn import_data(
    db: State<'_, Db>,
    json: String,
    mode: String,
) -> AppResult<ImportResult> {
    if mode != "replace" && mode != "merge" {
        return Err(AppError::validation("mode 'replace' ya da 'merge' olmalı"));
    }
    let payload: ExportPayload = serde_json::from_str(&json)
        .map_err(|e| AppError::validation(format!("Geçersiz yedek dosyası: {e}")))?;

    if mode == "replace" {
        do_replace(&db.pool, payload).await
    } else {
        do_merge(&db.pool, payload).await
    }
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub mode: String,
    pub portfolios_added: usize,
    pub assets_added: usize,
    pub transactions_added: usize,
    pub alerts_added: usize,
    pub goals_added: usize,
    pub budgets_added: usize,
}

async fn do_replace(pool: &SqlitePool, p: ExportPayload) -> AppResult<ImportResult> {
    let mut tx = pool.begin().await?;

    // CASCADE'le tüm bağımlılıklar düşer
    sqlx::query("DELETE FROM budget_entries").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM budgets").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM goals").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM price_alerts").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM price_cache").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM transaction_tags").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM transactions").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM assets").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM portfolios").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM profiles").execute(&mut *tx).await?;
    // sqlite_sequence sıfırla (id'ler 1'den başlasın import'la uyumlu)
    let _ = sqlx::query("DELETE FROM sqlite_sequence").execute(&mut *tx).await;

    // Profilleri önce (FK)
    if p.profiles.is_empty() {
        // Eski yedeklerde profil yok — default profil oluştur
        sqlx::query("INSERT OR IGNORE INTO profiles (id, name, created_at) VALUES (1, 'Profil 1', ?)")
            .bind(crate::commands::now_secs())
            .execute(&mut *tx)
            .await?;
    } else {
        for pr in &p.profiles {
            sqlx::query("INSERT INTO profiles (id, name, pinned, created_at) VALUES (?, ?, ?, ?)")
                .bind(pr.id)
                .bind(&pr.name)
                .bind(pr.pinned)
                .bind(pr.created_at)
                .execute(&mut *tx)
                .await?;
        }
    }
    for p in &p.portfolios {
        sqlx::query(
            "INSERT INTO portfolios (id, name, created_at, pinned, profile_id) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(p.id)
        .bind(&p.name)
        .bind(p.created_at)
        .bind(p.pinned)
        .bind(p.profile_id)
        .execute(&mut *tx)
        .await?;
    }
    for b in &p.budgets {
        sqlx::query(
            "INSERT INTO budgets (id, name, monthly_income, monthly_expense, currency,
                                   target_value, target_date, pinned, created_at, profile_id, target_currency)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(b.id)
        .bind(&b.name)
        .bind(b.monthly_income)
        .bind(b.monthly_expense)
        .bind(&b.currency)
        .bind(b.target_value)
        .bind(b.target_date)
        .bind(b.pinned)
        .bind(b.created_at)
        .bind(b.profile_id)
        .bind(&b.target_currency)
        .execute(&mut *tx)
        .await?;
    }
    for e in &p.budget_entries {
        sqlx::query(
            "INSERT INTO budget_entries (budget_id, year_month, income, expense, note, recorded_at, currency, fx_to_usd)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(e.budget_id)
        .bind(&e.year_month)
        .bind(e.income)
        .bind(e.expense)
        .bind(&e.note)
        .bind(e.recorded_at)
        .bind(&e.currency)
        .bind(e.fx_to_usd)
        .execute(&mut *tx)
        .await?;
    }
    for a in &p.assets {
        sqlx::query(
            "INSERT INTO assets (id, portfolio_id, symbol, name, type, currency, external_id, created_at,
                                 expected_yield_pct, icon_url, platform)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(a.id)
        .bind(a.portfolio_id)
        .bind(&a.symbol)
        .bind(&a.name)
        .bind(&a.asset_type)
        .bind(&a.currency)
        .bind(&a.external_id)
        .bind(a.created_at)
        .bind(a.expected_yield_pct)
        .bind(&a.icon_url)
        .bind(&a.platform)
        .execute(&mut *tx)
        .await?;
    }
    for t in &p.transactions {
        sqlx::query(
            "INSERT INTO transactions (id, asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform, expected_yield_pct)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(t.id)
        .bind(t.asset_id)
        .bind(t.date)
        .bind(&t.tx_type)
        .bind(&t.source)
        .bind(t.quantity)
        .bind(t.price)
        .bind(t.fee)
        .bind(&t.note)
        .bind(t.is_deleted)
        .bind(t.created_at)
        .bind(t.fx_to_usd)
        .bind(&t.platform)
        .bind(t.expected_yield_pct)
        .execute(&mut *tx)
        .await?;
    }
    for tt in &p.transaction_tags {
        sqlx::query("INSERT OR IGNORE INTO transaction_tags (transaction_id, tag) VALUES (?, ?)")
            .bind(tt.transaction_id)
            .bind(&tt.tag)
            .execute(&mut *tx)
            .await?;
    }
    for c in &p.price_cache {
        sqlx::query("INSERT INTO price_cache (asset_id, price, currency, fetched_at) VALUES (?, ?, ?, ?)")
            .bind(c.asset_id)
            .bind(c.price)
            .bind(&c.currency)
            .bind(c.fetched_at)
            .execute(&mut *tx)
            .await?;
    }
    for a in &p.price_alerts {
        sqlx::query(
            "INSERT INTO price_alerts (id, asset_id, condition, threshold, currency, active, triggered_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(a.id)
        .bind(a.asset_id)
        .bind(&a.condition)
        .bind(a.threshold)
        .bind(&a.currency)
        .bind(a.active)
        .bind(a.triggered_at)
        .bind(a.created_at)
        .execute(&mut *tx)
        .await?;
    }
    for g in &p.goals {
        sqlx::query(
            "INSERT INTO goals (id, name, target_value, currency, target_date, achieved_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(g.id)
        .bind(&g.name)
        .bind(g.target_value)
        .bind(&g.currency)
        .bind(g.target_date)
        .bind(g.achieved_at)
        .bind(g.created_at)
        .execute(&mut *tx)
        .await?;
    }
    for s in &p.settings {
        sqlx::query(
            "INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(&s.key)
        .bind(&s.value)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(ImportResult {
        mode: "replace".into(),
        portfolios_added: p.portfolios.len(),
        assets_added: p.assets.len(),
        transactions_added: p.transactions.len(),
        alerts_added: p.price_alerts.len(),
        goals_added: p.goals.len(),
        budgets_added: p.budgets.len(),
    })
}

async fn do_merge(pool: &SqlitePool, p: ExportPayload) -> AppResult<ImportResult> {
    // Merge stratejisi:
    //  - portfolios: name eşleşiyorsa skip; yoksa ekle (yeni id atanır)
    //  - assets: (portfolio_id, symbol) UNIQUE — eşleşiyorsa skip
    //  - transactions: (asset_id, date, type, quantity, price) tuple ile dupe check
    //  - transaction_tags: transaction yeni ise tag'ler de eklenir
    //  - alerts/goals: aynı içerik varsa atla, yoksa ekle (yeni id)
    //  - settings: kullanıcının mevcut tercihlerine dokunmuyoruz (skip)

    let mut tx = pool.begin().await?;
    let mut portfolios_added = 0;
    let mut assets_added = 0;
    let mut transactions_added = 0;
    let mut alerts_added = 0;
    let mut goals_added = 0;

    // Portfolio mapping: import id → local id
    let mut p_map: std::collections::HashMap<i64, i64> =
        std::collections::HashMap::with_capacity(p.portfolios.len());
    for ip in &p.portfolios {
        let existing: Option<(i64,)> =
            sqlx::query_as("SELECT id FROM portfolios WHERE name = ?")
                .bind(&ip.name)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some((id,)) = existing {
            p_map.insert(ip.id, id);
        } else {
            let new_id: (i64,) = sqlx::query_as(
                "INSERT INTO portfolios (name, created_at, profile_id) VALUES (?, ?, ?) RETURNING id",
            )
            .bind(&ip.name)
            .bind(ip.created_at)
            .bind(ip.profile_id)
            .fetch_one(&mut *tx)
            .await?;
            p_map.insert(ip.id, new_id.0);
            portfolios_added += 1;
        }
    }

    // Asset mapping
    let mut a_map: std::collections::HashMap<i64, i64> =
        std::collections::HashMap::with_capacity(p.assets.len());
    for ia in &p.assets {
        let local_pid = match p_map.get(&ia.portfolio_id) {
            Some(&v) => v,
            None => continue,
        };
        let existing: Option<(i64,)> =
            sqlx::query_as("SELECT id FROM assets WHERE portfolio_id = ? AND symbol = ?")
                .bind(local_pid)
                .bind(&ia.symbol)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some((id,)) = existing {
            a_map.insert(ia.id, id);
        } else {
            let new_id: (i64,) = sqlx::query_as(
                "INSERT INTO assets (portfolio_id, symbol, name, type, currency, external_id, created_at,
                                     expected_yield_pct, icon_url, platform)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            )
            .bind(local_pid)
            .bind(&ia.symbol)
            .bind(&ia.name)
            .bind(&ia.asset_type)
            .bind(&ia.currency)
            .bind(&ia.external_id)
            .bind(ia.created_at)
            .bind(ia.expected_yield_pct)
            .bind(&ia.icon_url)
            .bind(&ia.platform)
            .fetch_one(&mut *tx)
            .await?;
            a_map.insert(ia.id, new_id.0);
            assets_added += 1;
        }
    }

    // Transactions — dupe kontrolü (asset_id+date+type+quantity+price)
    let mut t_map: std::collections::HashMap<i64, i64> =
        std::collections::HashMap::with_capacity(p.transactions.len());
    for it in &p.transactions {
        let local_aid = match a_map.get(&it.asset_id) {
            Some(&v) => v,
            None => continue,
        };
        let existing: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM transactions
             WHERE asset_id = ? AND date = ? AND type = ?
               AND ABS(quantity - ?) < 0.0000001 AND ABS(price - ?) < 0.0000001
             LIMIT 1",
        )
        .bind(local_aid)
        .bind(it.date)
        .bind(&it.tx_type)
        .bind(it.quantity)
        .bind(it.price)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some((id,)) = existing {
            t_map.insert(it.id, id);
        } else {
            let new_id: (i64,) = sqlx::query_as(
                "INSERT INTO transactions
                    (asset_id, date, type, source, quantity, price, fee, note, is_deleted, created_at, fx_to_usd, platform, expected_yield_pct)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            )
            .bind(local_aid)
            .bind(it.date)
            .bind(&it.tx_type)
            .bind(&it.source)
            .bind(it.quantity)
            .bind(it.price)
            .bind(it.fee)
            .bind(&it.note)
            .bind(it.is_deleted)
            .bind(it.created_at)
            .bind(it.fx_to_usd)
            .bind(&it.platform)
            .bind(it.expected_yield_pct)
            .fetch_one(&mut *tx)
            .await?;
            t_map.insert(it.id, new_id.0);
            transactions_added += 1;
        }
    }

    for tt in &p.transaction_tags {
        if let Some(&local_tid) = t_map.get(&tt.transaction_id) {
            sqlx::query("INSERT OR IGNORE INTO transaction_tags (transaction_id, tag) VALUES (?, ?)")
                .bind(local_tid)
                .bind(&tt.tag)
                .execute(&mut *tx)
                .await?;
        }
    }

    for ia in &p.price_alerts {
        let local_aid = match a_map.get(&ia.asset_id) {
            Some(&v) => v,
            None => continue,
        };
        let existing: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM price_alerts WHERE asset_id = ? AND condition = ? AND ABS(threshold - ?) < 0.0000001",
        )
        .bind(local_aid)
        .bind(&ia.condition)
        .bind(ia.threshold)
        .fetch_optional(&mut *tx)
        .await?;
        if existing.is_none() {
            sqlx::query(
                "INSERT INTO price_alerts (asset_id, condition, threshold, currency, active, triggered_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(local_aid)
            .bind(&ia.condition)
            .bind(ia.threshold)
            .bind(&ia.currency)
            .bind(ia.active)
            .bind(ia.triggered_at)
            .bind(ia.created_at)
            .execute(&mut *tx)
            .await?;
            alerts_added += 1;
        }
    }

    for ig in &p.goals {
        let existing: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM goals WHERE name = ? AND ABS(target_value - ?) < 0.0000001",
        )
        .bind(&ig.name)
        .bind(ig.target_value)
        .fetch_optional(&mut *tx)
        .await?;
        if existing.is_none() {
            sqlx::query(
                "INSERT INTO goals (name, target_value, currency, target_date, achieved_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&ig.name)
            .bind(ig.target_value)
            .bind(&ig.currency)
            .bind(ig.target_date)
            .bind(ig.achieved_at)
            .bind(ig.created_at)
            .execute(&mut *tx)
            .await?;
            goals_added += 1;
        }
    }

    tx.commit().await?;

    Ok(ImportResult {
        mode: "merge".into(),
        portfolios_added,
        assets_added,
        transactions_added,
        alerts_added,
        goals_added,
        budgets_added: 0, // merge için budget desteği şimdilik replace mode'da
    })
}
