//! Live API entegrasyon testleri — Plan §12 Faz 3 acceptance kriterleri için.
//!
//! Bu test'ler INTERNET ister. CI'da `--ignored` ile çalıştırıp manuel
//! `cargo test --test live_apis -- --ignored` ile kontrol edilirler.
//!
//! Acceptance kanıtı: bu testler geçtiğinde
//!   - CoinGecko BTC fiyatı geliyor
//!   - Yahoo AAPL fiyatı geliyor
//!   - TCMB USD/TRY rate'i geliyor

use birik_lib::services::{coingecko, tcmb, yahoo};

#[tokio::test]
#[ignore]
async fn coingecko_btc_price() {
    let p = coingecko::fetch_price("bitcoin")
        .await
        .expect("CoinGecko BTC fiyatı");
    println!("BTC: usd={} try={} eur={}", p.usd, p.try_, p.eur);
    assert!(p.usd > 100.0, "BTC USD > 100 olmalı (sanity)");
}

#[tokio::test]
#[ignore]
async fn yahoo_aapl_price() {
    let p = yahoo::fetch_price("AAPL")
        .await
        .expect("Yahoo AAPL fiyatı");
    println!("AAPL: {} {}", p.price, p.currency);
    assert!(p.price > 0.0);
    assert_eq!(p.currency.to_uppercase(), "USD");
}

#[tokio::test]
#[ignore]
async fn tcmb_fx_has_usd_try() {
    let r = tcmb::fetch_rates().await.expect("TCMB rates");
    println!("TCMB rates: {} entries", r.rates.len());
    let usd = r
        .rates
        .get("USD")
        .copied()
        .expect("USD anahtarı TCMB'de var");
    println!("USD/TRY: {usd}");
    assert!(usd > 1.0, "USD/TRY > 1 olmalı");
}

#[tokio::test]
#[ignore]
async fn coingecko_search_returns_btc() {
    let hits = coingecko::search("bitcoin")
        .await
        .expect("CoinGecko search");
    println!("hits: {}", hits.len());
    assert!(hits.iter().any(|h| h.external_id == "bitcoin"));
}

#[tokio::test]
#[ignore]
async fn coingecko_btc_has_24h_change() {
    let p = coingecko::fetch_price("bitcoin")
        .await
        .expect("BTC fiyatı");
    println!("BTC 24h change: {:?}", p.usd_24h_change);
    assert!(p.usd_24h_change.is_some(), "include_24hr_change=true sonucu yok");
}
