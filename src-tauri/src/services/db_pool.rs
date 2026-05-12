use std::path::PathBuf;
use std::str::FromStr;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::error::AppResult;

/// Tauri State olarak inject edilen DB pool wrapper'ı.
pub struct Db {
    pub pool: SqlitePool,
}

impl Db {
    /// AppConfigDir altındaki birik.db'ye bağlan, gerekirse yarat,
    /// migration'ları uygula. Plugin-sql ile aynı dosyaya bağlanıyoruz —
    /// WAL mode olduğu için concurrent OK.
    pub async fn init(app: &AppHandle) -> AppResult<Self> {
        let dir: PathBuf = app
            .path()
            .app_config_dir()
            .map_err(|e| crate::error::AppError::external(format!("config dir: {e}")))?;
        std::fs::create_dir_all(&dir)?;
        let db_path = dir.join("birik.db");

        let opts = SqliteConnectOptions::from_str(&format!(
            "sqlite://{}",
            db_path.to_string_lossy()
        ))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(opts)
            .await?;

        // Migration'ları uygula. sqlx kendi _sqlx_migrations tablosunu
        // yönetir ve uygulanmış olanları skip eder (idempotent).
        sqlx::migrate!("./src/db/migrations").run(&pool).await?;

        // Defansif schema check — sqlx::migrate herhangi bir sebepten
        // (eski binary çakışması, _sqlx_migrations'da skip vs.) eksik
        // kolon bıraktıysa burada tamamla. SQLite IF NOT EXISTS desteklemediği
        // için manuel pragma kontrolü.
        ensure_columns(&pool).await?;

        log::info!("[birik] db pool ready: {}", db_path.display());

        Ok(Self { pool })
    }
}

/// Şu kolonların var olduğunu garanti et — yoksa ALTER TABLE ile ekle.
/// Bu fonksiyon migration sisteminin "eksik bıraktıkları" için emniyet ağı.
///
/// NOT: `pragma_table_info(?)` parametre bind'i SQLite'da güvenilir değil
/// (PRAGMA fonksiyonları string literal bekliyor). Bu yüzden tablo adını
/// SQL'e doğrudan enjekte ediyoruz — required listesinden geldiği için
/// SQL injection riski yok.
async fn ensure_columns(pool: &SqlitePool) -> AppResult<()> {
    // (table, column, sql_def)
    let required: &[(&str, &str, &str)] = &[
        ("price_cache", "change_24h_pct", "REAL"),
        ("assets", "expected_yield_pct", "REAL"),
        ("assets", "icon_url", "TEXT"),
        ("portfolios", "pinned", "INTEGER NOT NULL DEFAULT 0"),
        ("portfolios", "profile_id", "INTEGER NOT NULL DEFAULT 1"),
        ("budgets", "profile_id", "INTEGER"),
        ("budgets", "target_currency", "TEXT"),
        ("budget_entries", "currency", "TEXT"),
        ("budget_entries", "fx_to_usd", "REAL"),
        ("transactions", "fx_to_usd", "REAL"),
        ("assets", "platform", "TEXT"),
        ("transactions", "platform", "TEXT"),
        ("transactions", "expected_yield_pct", "REAL"),
    ];

    for (table, column, def) in required {
        // PRAGMA için sabit-liste tablo adını doğrudan SQL'e koy
        let check_sql = format!(
            "SELECT 1 FROM pragma_table_info('{}') WHERE name = ?1 LIMIT 1",
            table
        );
        let exists: Option<i64> = sqlx::query_scalar(&check_sql)
            .bind(column)
            .fetch_optional(pool)
            .await?;

        if exists.is_none() {
            let sql = format!("ALTER TABLE {table} ADD COLUMN {column} {def}");
            log::warn!("[birik] adding missing column: {table}.{column}");
            eprintln!("[birik] ensure_columns: ADD COLUMN {table}.{column} {def}");
            sqlx::query(&sql).execute(pool).await?;
        }
    }

    // Doğrulama log'u — boot'ta hangi kolonların var olduğunu söyle
    for (table, column, _) in required {
        let check_sql = format!(
            "SELECT 1 FROM pragma_table_info('{}') WHERE name = ?1 LIMIT 1",
            table
        );
        let exists: Option<i64> = sqlx::query_scalar(&check_sql)
            .bind(column)
            .fetch_optional(pool)
            .await?;
        eprintln!(
            "[birik] schema check: {}.{} = {}",
            table,
            column,
            if exists.is_some() { "OK" } else { "MISSING" }
        );
    }

    Ok(())
}
