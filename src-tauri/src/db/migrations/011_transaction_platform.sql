-- 011: İşlem bazında platform (varlık değil işlem seviyesinde).
--
-- Aynı varlık iki ayrı platformda tutulabilir (örn BTC hem Binance hem Kraken).
-- Bu yüzden işlem başına platform tutulur; asset.platform alanı varlığın
-- "ana" platformu için opsiyonel kalır (ileride birleşik view için).

ALTER TABLE transactions ADD COLUMN platform TEXT;
