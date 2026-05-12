-- 003: Günlük portföy değer snapshot'ları (tempolu hedef ETA için).
-- Background loop her 24 saatte bir (portfolio_id, currency, date) tuple'ı yazar.
-- Aynı gün içinde tekrar yazılırsa REPLACE — gün sonundaki son değer geçerli.

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  portfolio_id  INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  currency      TEXT NOT NULL,
  -- yyyy-mm-dd formatında — gün başına 1 satır per portfolio+currency
  date          TEXT NOT NULL,
  total_value   REAL NOT NULL,
  recorded_at   INTEGER NOT NULL,  -- unix timestamp (saniye)
  PRIMARY KEY (portfolio_id, currency, date)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_date ON portfolio_snapshots(date);
