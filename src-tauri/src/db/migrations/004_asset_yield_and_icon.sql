-- 004: Asset bazında metadata
--   - expected_yield_pct: kullanıcının bu varlık için yıllık beklediği nakit
--     akışı (% staking/temettü/faiz). Pasif gelir tahminleri için.
--   - icon_url: kripto için CoinGecko logo, hisse için Clearbit/Logo.dev fallback URL.

ALTER TABLE assets ADD COLUMN expected_yield_pct REAL;
ALTER TABLE assets ADD COLUMN icon_url TEXT;
