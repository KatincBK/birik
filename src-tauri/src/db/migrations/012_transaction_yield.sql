-- 012: İşlem bazında yield/faiz oranı
--
-- Aynı varlık farklı platformda/farklı dönemde farklı faiz oranlarında olabilir
-- (örn USDT Binance %4, Mintos %6). Yield artık asset-level değil tx-level.
-- NULL = asset.expected_yield_pct fallback (geriye uyumlu).

ALTER TABLE transactions ADD COLUMN expected_yield_pct REAL;
