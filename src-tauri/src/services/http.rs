use once_cell::sync::Lazy;
use reqwest::Client;
use std::time::Duration;

/// Process-wide reqwest Client. Connection pool reuse, gzip, charset.
///
/// User-Agent tarayıcı benzeri — Yahoo/Cloudflare ve CoinGecko bazı
/// "bot benzeri" UA'ları (örn. "Birik/0.1") agresif rate-limit'liyor
/// veya 403 dönüyor. Browser UA + Accept başlığı sorunu çözüyor.
pub static HTTP: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
             AppleWebKit/537.36 (KHTML, like Gecko) \
             Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(8))
        .gzip(true)
        .build()
        .expect("reqwest client build")
});
