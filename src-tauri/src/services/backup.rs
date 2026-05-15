//! Yedekleme servisi — PLAN §12 Faz 7.
//!
//! - `write_backup(app, pool)`: AppData/com.birik.app/backups/yyyy-mm-dd-HHMMSS.json
//! - `prune_old(dir, keep)`: en eski dosyaları sil, son `keep` taneyi tut
//! - `spawn_daily(app)`: 24 saatte bir otomatik backup loop'u
//! - `mark_dirty()` + `spawn_tx_writer(app)`: her transaction sonrası debounced backup

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use once_cell::sync::Lazy;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tokio::sync::Notify;

use crate::commands::backup::build_export_payload;
use crate::services::Db;

const KEEP_DAILY: usize = 30; // tx-backup pattern: günlük yedek + tx başı yedek; 30 tane sakla
const TX_DEBOUNCE_MS: u64 = 2_500; // ardışık tx'leri tek backup'a indirgeyen gecikme

static TX_DIRTY: Lazy<Arc<Notify>> = Lazy::new(|| Arc::new(Notify::new()));

/// Bir veri-değiştirici komut tamamlandığında çağır — sessiz, ucuz, eşzamansız.
/// Notify::notify_one() buffer'lı: ardışık 100 çağrı tek wakeup'a düşer.
pub fn mark_dirty() {
    TX_DIRTY.notify_one();
}

/// Boot'ta bir kez spawn et. mark_dirty() çağrısı geldiğinde TX_DEBOUNCE_MS
/// kadar bekler, sonra yedek yazar. Yedek yazılırken gelen çağrılar bir sonraki
/// turda işlenir.
pub fn spawn_tx_writer(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            TX_DIRTY.notified().await;
            tokio::time::sleep(Duration::from_millis(TX_DEBOUNCE_MS)).await;
            let db = app.state::<Db>();
            if let Err(e) = write_backup(&app, &db.pool).await {
                log::warn!("[birik] tx backup failed: {e}");
            }
        }
    });
}

pub async fn write_backup(app: &AppHandle, pool: &SqlitePool) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    let dir = backup_dir(app)?;
    std::fs::create_dir_all(&dir)?;

    let now = chrono::Utc::now();
    let stamp = now.format("%Y-%m-%d-%H%M%S").to_string();
    let path = dir.join(format!("birik-{stamp}.json"));

    let payload = build_export_payload(pool).await?;
    let json = serde_json::to_string_pretty(&payload)?;
    std::fs::write(&path, json)?;

    prune_old(&dir, KEEP_DAILY)?;

    log::info!("[birik] backup written: {}", path.display());
    Ok(path)
}

fn backup_dir(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    Ok(app.path().app_config_dir()?.join("backups"))
}

fn prune_old(dir: &std::path::Path, keep: usize) -> std::io::Result<()> {
    let mut entries: Vec<_> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("birik-")
        })
        .collect();
    if entries.len() <= keep {
        return Ok(());
    }
    entries.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
    let drop = entries.len() - keep;
    for e in entries.into_iter().take(drop) {
        let _ = std::fs::remove_file(e.path());
    }
    Ok(())
}

/// Günlük otomatik backup + portföy snapshot. Boot'ta bir kez yazıp sonra
/// 24 saat aralıklı tick. `auto_backup` false ise yedek yazılmaz ama snapshot
/// her halükarda yazılır (ETA hesabı için kritik).
pub fn spawn_daily(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Boot'ta hemen yazma — 1 dk sonra ilk yaz, sonra 24h.
        tokio::time::sleep(Duration::from_secs(60)).await;

        loop {
            let db = app.state::<Db>();
            // Snapshot yazımı (her zaman)
            if let Err(e) = write_portfolio_snapshots(&db.pool).await {
                log::warn!("[birik] snapshot write failed: {e}");
            }
            // Backup yazımı (setting'e bağlı)
            if auto_backup_enabled(&app).await {
                if let Err(e) = write_backup(&app, &db.pool).await {
                    log::warn!("[birik] auto backup failed: {e}");
                }
            }
            tokio::time::sleep(Duration::from_secs(24 * 60 * 60)).await;
        }
    });
}

/// Her portföy için bugünkü total_value'yu portfolio_snapshots'a yaz.
/// Aynı (portfolio_id, currency, date) varsa REPLACE.
async fn write_portfolio_snapshots(pool: &SqlitePool) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use crate::db::models::Portfolio;

    let portfolios: Vec<Portfolio> =
        sqlx::query_as("SELECT id, name, created_at, pinned, profile_id FROM portfolios")
            .fetch_all(pool)
            .await?;

    // Hangi currency'de yazacağız? Settings.display_currency tek doğruluk —
    // kullanıcı USD takip ediyorsa USD snapshot anlamlı. ETA aynı currency'de
    // hesap edilmeli.
    let display_currency: String = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key = 'display_currency'",
    )
    .fetch_optional(pool)
    .await?
    .unwrap_or_else(|| "USD".to_string());

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let now = chrono::Utc::now().timestamp();

    // Hangi currency'leri yazıyoruz: kullanıcı display + USD (her zaman, dashboard
    // trend grafiği multi-currency convert için USD-base'e ihtiyaç duyar).
    let mut currencies = vec!["USD".to_string()];
    if !display_currency.eq_ignore_ascii_case("USD") {
        currencies.push(display_currency.clone());
    }

    for p in portfolios {
        for ccy in &currencies {
            // calculate_portfolio_inner doğru hesap (FX dahil)
            let stats = match crate::commands::calc::calculate_portfolio_inner(pool, p.id, ccy).await {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("[birik] snapshot calc fail (portfolio={}, ccy={ccy}): {e}", p.id);
                    continue;
                }
            };
            let v = stats.total_value;
            sqlx::query(
                "INSERT INTO portfolio_snapshots (portfolio_id, currency, date, total_value, recorded_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(portfolio_id, currency, date) DO UPDATE SET
                    total_value = excluded.total_value,
                    recorded_at = excluded.recorded_at",
            )
            .bind(p.id)
            .bind(ccy)
            .bind(&today)
            .bind(v)
            .bind(now)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

async fn auto_backup_enabled(app: &AppHandle) -> bool {
    let db = app.state::<Db>();
    let v: Option<(String,)> =
        sqlx::query_as("SELECT value FROM settings WHERE key = 'auto_backup'")
            .fetch_optional(&db.pool)
            .await
            .ok()
            .flatten();
    v.map(|t| t.0 == "true").unwrap_or(true)
}
