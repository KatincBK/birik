pub mod alert;
pub mod asset;
pub mod backup;
pub mod budget;
pub mod calc;
pub mod goal;
pub mod health;
pub mod history;
pub mod home;
pub mod investment;
pub mod news;
pub mod portfolio;
pub mod price;
pub mod profile;
pub mod search;
pub mod setting;
pub mod snapshot;
pub mod transaction;

/// Şu an unix timestamp (saniye).
pub fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}
