-- 009: Aylık yatırım/birikim takibi (bütçeden ayrı)
--
-- Bütçe = gelir/gider, Yatırım = kullanıcının her ay portföye koyduğu para.
-- Bütçedeki "income - expense" yatırım anlamına gelmez (kişi tasarrufunu
-- yatırıma yönlendirmemiş olabilir, veya farklı para birimlerinde yatırım
-- yapabilir).
--
-- PK (profile_id, year_month, currency) — bir ay içinde multi-currency
-- yatırım olabilir (örn. mart 2024'te 5000 TRY + 100 USD).
-- fx_to_usd entry tarihinde lock'lanır (ay ortası, Frankfurter historical).

CREATE TABLE IF NOT EXISTS investment_entries (
  profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  year_month   TEXT NOT NULL,           -- 'YYYY-MM'
  currency     TEXT NOT NULL,           -- 'USD' | 'TRY' | 'EUR' | 'GBP' …
  amount       REAL NOT NULL,
  fx_to_usd    REAL,                    -- 1 currency = X USD, ay ortası kilit
  note         TEXT,
  recorded_at  INTEGER NOT NULL,
  PRIMARY KEY (profile_id, year_month, currency)
);

CREATE INDEX IF NOT EXISTS idx_investment_profile_ym
  ON investment_entries(profile_id, year_month DESC);
