-- 007: Multi-currency entry/transaction + tarihsel kur kilit (USD base)
--
-- Tasarım: kullanıcı bir entry/transaction yazdığında o günkü USD karşılığı
-- DB'ye sabit yazılır. Display tarafı USD-locked değeri current FX ile seçilen
-- display currency'ye çevirir. NULL kalan kayıtlar (eski veriler) display
-- tarafında current FX ile fallback.

-- Bütçe entry'leri çoklu currency: kullanıcı her ay farklı currency girebilir
ALTER TABLE budget_entries ADD COLUMN currency TEXT;
ALTER TABLE budget_entries ADD COLUMN fx_to_usd REAL;

-- Transaction'da fx_to_usd: 1 asset.currency = X USD (transaction.date günü)
-- asset.currency=USD ise 1.0, TRY/EUR vb. için tarihsel kur
ALTER TABLE transactions ADD COLUMN fx_to_usd REAL;

-- Bütçenin hedef currency'si gelir/gider currency'sinden ayrı olabilir
ALTER TABLE budgets ADD COLUMN target_currency TEXT;
