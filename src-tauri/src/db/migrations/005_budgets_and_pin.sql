-- 005: Bütçe planlama + portföy pin
--
-- budgets: birden fazla isimli bütçe (örn. "Ev", "Tatil"). Her biri kendi
--   aylık gelir/giderini ve hedef değerini tutar.
-- budget_entries: aylık gerçekleşen veriler (yyyy-mm bazlı). Madde 4 — aylık
--   bütçe izleme. UNIQUE (budget_id, year_month).
-- portfolios.pinned: kullanıcı sağ tıklayıp "pin" ettiğinde 1, pinli sidebar
--   üstte sıralanır.

CREATE TABLE IF NOT EXISTS budgets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  monthly_income  REAL NOT NULL DEFAULT 0,
  monthly_expense REAL NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'USD',
  -- Opsiyonel hedef (eski Goals'un yerine)
  target_value    REAL,
  target_date     INTEGER,   -- unix sec; null = açık uçlu
  pinned          INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_entries (
  budget_id    INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  year_month   TEXT NOT NULL,           -- "2026-05"
  income       REAL NOT NULL DEFAULT 0,
  expense      REAL NOT NULL DEFAULT 0,
  note         TEXT,
  recorded_at  INTEGER NOT NULL,
  PRIMARY KEY (budget_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_budget_entries_month ON budget_entries(year_month);

ALTER TABLE portfolios ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
