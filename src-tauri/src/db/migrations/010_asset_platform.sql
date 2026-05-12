-- 010: Varlığın bulunduğu platform/borsa (opsiyonel metadata)
--
-- Örn: "Binance", "Kraken", "İş Bankası", "Mintos". Kullanıcı isterse
-- ekler — uniqueness etkilenmez (assets.UNIQUE hâlâ portfolio_id+symbol).
-- Aynı sembolün birden fazla platformdaki tutarı tek asset altında toplanır;
-- platform alanı son güncellenen değeri tutar.

ALTER TABLE assets ADD COLUMN platform TEXT;
