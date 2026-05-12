use serde::{Serialize, Serializer};

/// Tüm Tauri komutlarının döndüğü Result tipi.
/// Frontend'e string olarak serialize ediliyor (tauri serde-friendly).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("veritabanı hatası: {0}")]
    Sqlx(#[from] sqlx::Error),

    #[error("migration hatası: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),

    #[error("ağ hatası: {0}")]
    Reqwest(#[from] reqwest::Error),

    #[error("XML parse hatası: {0}")]
    Xml(#[from] quick_xml::DeError),

    #[error("JSON hatası: {0}")]
    Json(#[from] serde_json::Error),

    #[error("g/ç hatası: {0}")]
    Io(#[from] std::io::Error),

    #[error("Tauri hatası: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("doğrulama hatası: {0}")]
    Validation(String),

    #[error("bulunamadı: {0}")]
    NotFound(String),

    #[error("dış kaynak hatası: {0}")]
    External(String),
}

impl AppError {
    pub fn validation(msg: impl Into<String>) -> Self {
        AppError::Validation(msg.into())
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        AppError::NotFound(msg.into())
    }

    pub fn external(msg: impl Into<String>) -> Self {
        AppError::External(msg.into())
    }
}

/// Frontend'e gidecek string serialization.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
