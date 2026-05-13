-- 013: Bütçe planlama modeli — tek-tek aylık entry'ler yerine line item + date range.
--
-- Eski `budget_entries` (her ay tek income/expense) bırakılıyor (fresh start
-- onayı, kullanıcı isteği). Yeni `budget_lines` her satır:
--   - kind: income | expense
--   - label: kullanıcının verdiği isim ("Maaş", "Kira")
--   - amount + currency (multi-currency)
--   - start_ym, end_ym ('YYYY-MM' format, end_ym NULL = açık uçlu)
--
-- Bir line item, [start_ym, end_ym] aralığındaki her aya katkı yapar.
-- Monthly summary backend tarafında hesaplanır.
--
-- `budget_month_overrides`: kullanıcı bir ayın gerçek verilerini "interpole et"
-- olarak işaretleyebilir — o ay graph'ta gri nokta olarak çıkar ve değeri
-- komşu ayların ortalaması.

DROP TABLE IF EXISTS budget_entries;

CREATE TABLE IF NOT EXISTS budget_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_id   INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('income','expense')),
  label       TEXT NOT NULL,
  amount      REAL NOT NULL,
  currency    TEXT NOT NULL,
  start_ym    TEXT NOT NULL,             -- 'YYYY-MM'
  end_ym      TEXT,                       -- 'YYYY-MM' nullable = açık uçlu
  fx_to_usd   REAL,                       -- start_ym ay ortası USD kilit (reporting için)
  note        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_budget_lines_budget ON budget_lines(budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_lines_range  ON budget_lines(start_ym, end_ym);

CREATE TABLE IF NOT EXISTS budget_month_overrides (
  budget_id    INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  year_month   TEXT NOT NULL,
  interpolate  INTEGER NOT NULL DEFAULT 0,   -- 1 = bu ayı interpole et (gri nokta)
  PRIMARY KEY (budget_id, year_month)
);
