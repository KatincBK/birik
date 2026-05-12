//! Binance WebSocket — kripto için canlı fiyat akışı.
//!
//! Endpoint: `wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/...`
//! Mesaj formatı: `{"stream": "btcusdt@ticker", "data": {"c": "80350.50", "P": "1.23"}}`
//!   c = close (current price)
//!   P = priceChangePercent (24h %)
//!
//! Worker döngüsü:
//!   1. DB'den crypto asset listesini al (symbol → asset_id map)
//!   2. Binance combined stream'e bağlan
//!   3. Mesaj geldiğinde:
//!       - price_cache'i güncelle (USD bazlı)
//!       - Tauri event emit et: "price_tick" payload { asset_id, price, change_24h_pct }
//!   4. 5 dk'da bir asset listesini reload et — yeni asset eklendiyse reconnect
//!   5. Bağlantı kopuşunda 5 sn sonra reconnect

use std::collections::HashMap;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::services::Db;

const RECONNECT_AFTER_SECS: u64 = 5;
const RELOAD_INTERVAL_SECS: u64 = 5 * 60;

/// Frontend'e gönderilen tick payload'ı
#[derive(Debug, Clone, Serialize)]
pub struct PriceTick {
    pub asset_id: i64,
    pub symbol: String,
    pub price: f64,
    pub change_24h_pct: f64,
    pub currency: String,
}

#[derive(Debug, Deserialize)]
struct CombinedMessage {
    stream: String,
    data: TickerData,
}

#[derive(Debug, Deserialize)]
struct TickerData {
    /// Close (current) price
    #[serde(rename = "c")]
    close: String,
    /// Price change percent (24h)
    #[serde(rename = "P")]
    change_pct: String,
    /// Symbol (BTCUSDT vs.)
    #[serde(rename = "s", default)]
    #[allow(dead_code)]
    symbol: String,
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(e) = run_session(&app).await {
                log::warn!("[birik] binance ws session ended: {e}");
            }
            tokio::time::sleep(Duration::from_secs(RECONNECT_AFTER_SECS)).await;
        }
    });
}

async fn run_session(app: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db = app.state::<Db>();
    let pool = db.pool.clone();

    // Crypto asset listesi → symbol → asset_id map
    let assets = load_crypto_assets(&pool).await?;
    if assets.is_empty() {
        // Hiç kripto asset yoksa 5 dk sonra tekrar bak
        tokio::time::sleep(Duration::from_secs(60)).await;
        return Ok(());
    }

    // Symbol → BTCUSDT pair'ine çevir
    let mut sym_to_id: HashMap<String, (i64, String)> = HashMap::with_capacity(assets.len());
    for (id, symbol) in &assets {
        let pair = format!("{}USDT", symbol.to_lowercase());
        sym_to_id.insert(pair.to_uppercase(), (*id, symbol.clone()));
    }

    let streams = sym_to_id
        .keys()
        .map(|s| format!("{}@ticker", s.to_lowercase()))
        .collect::<Vec<_>>()
        .join("/");
    let url = format!("wss://stream.binance.com:9443/stream?streams={streams}");
    log::info!("[birik] binance ws connecting: {} streams", sym_to_id.len());
    eprintln!("[birik] binance ws → {} streams", sym_to_id.len());

    let (ws, _resp) = connect_async(&url).await?;
    let (mut write, mut read) = ws.split();

    // Reload tick — listeyi yeniden kontrol etmek için
    let mut reload_timer = tokio::time::interval(Duration::from_secs(RELOAD_INTERVAL_SECS));
    reload_timer.tick().await; // ilk tick'i yut

    loop {
        tokio::select! {
            msg = read.next() => {
                let Some(msg) = msg else { break; };
                match msg {
                    Ok(Message::Text(text)) => {
                        if let Ok(parsed) = serde_json::from_str::<CombinedMessage>(&text) {
                            // stream: "btcusdt@ticker" → "BTCUSDT"
                            let pair = parsed
                                .stream
                                .split('@')
                                .next()
                                .unwrap_or("")
                                .to_uppercase();
                            if let Some((asset_id, symbol)) = sym_to_id.get(&pair) {
                                let price: f64 = parsed.data.close.parse().unwrap_or(0.0);
                                let pct: f64 = parsed.data.change_pct.parse().unwrap_or(0.0);
                                if price > 0.0 {
                                    // price_cache güncelle (5 dk TTL içinde reuse)
                                    let _ = crate::services::cache::put(
                                        &pool, *asset_id, price, "USD", Some(pct),
                                    )
                                    .await;

                                    // Tauri event emit
                                    let payload = PriceTick {
                                        asset_id: *asset_id,
                                        symbol: symbol.clone(),
                                        price,
                                        change_24h_pct: pct,
                                        currency: "USD".into(),
                                    };
                                    let _ = app.emit("price_tick", payload);
                                }
                            }
                        }
                    }
                    Ok(Message::Ping(p)) => {
                        let _ = write.send(Message::Pong(p)).await;
                    }
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => {}
                }
            }
            _ = reload_timer.tick() => {
                // Asset listesi değiştiyse reconnect tetikle (return → outer reconnect)
                let now_assets = load_crypto_assets(&pool).await.unwrap_or_default();
                if now_assets.len() != assets.len()
                    || now_assets.iter().any(|(id, _)| !assets.iter().any(|(aid, _)| aid == id))
                {
                    log::info!("[birik] binance ws asset list changed, reconnecting");
                    let _ = write.send(Message::Close(None)).await;
                    return Ok(());
                }
            }
        }
    }

    Ok(())
}

async fn load_crypto_assets(pool: &SqlitePool) -> sqlx::Result<Vec<(i64, String)>> {
    let rows: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, symbol FROM assets WHERE type = 'crypto'",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
