-- 002: price_cache'e 24h değişim yüzdesi alanı.
-- CoinGecko `simple/price` endpoint'i `include_24hr_change=true` ile yüzde döner;
-- Yahoo `chart.meta.previousClose` kullanılarak hesaplanır;
-- Stooq fallback'te open vs close yaklaşımı.

ALTER TABLE price_cache ADD COLUMN change_24h_pct REAL;
