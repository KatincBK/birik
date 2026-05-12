-- 001_initial: PLAN §9 — tüm temel tablolar + default veri
-- Bu migration tauri-plugin-sql tarafından bir kez çalıştırılır
-- (plugin _sqlx_migrations tablosu ile versiyon takibi yapar).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portfolios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id  INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('crypto','stock','fx','commodity')),
  currency      TEXT NOT NULL,
  external_id   TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE(portfolio_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_assets_portfolio ON assets(portfolio_id);

CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id    INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  date        INTEGER NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('buy','sell','passive_income')),
  source      TEXT CHECK (source IS NULL OR source IN ('staking','dividend','interest')),
  quantity    REAL NOT NULL,
  price       REAL NOT NULL,
  fee         REAL NOT NULL DEFAULT 0,
  note        TEXT,
  is_deleted  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_asset ON transactions(asset_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date  ON transactions(date);

CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag            TEXT NOT NULL,
  PRIMARY KEY (transaction_id, tag)
);

CREATE TABLE IF NOT EXISTS price_cache (
  asset_id    INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  price       REAL NOT NULL,
  currency    TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS price_alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  condition     TEXT NOT NULL CHECK (condition IN ('above','below')),
  threshold     REAL NOT NULL,
  currency      TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  triggered_at  INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_active ON price_alerts(active);

CREATE TABLE IF NOT EXISTS goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  target_value  REAL NOT NULL,
  currency      TEXT NOT NULL,
  target_date   INTEGER,
  achieved_at   INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Default portföy. id=1 sabit — "ilk portföy her zaman 1" varsayımı için.
-- INSERT OR IGNORE: ikinci kez çalışsa bile no-op (zaten plugin migration'ı tekrarlamaz,
-- ama DB elle bozulursa korur).
INSERT OR IGNORE INTO portfolios (id, name, created_at)
VALUES (1, 'Ana Portföy', strftime('%s','now'));

-- Default settings — PLAN §9'daki kayıtlar
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('display_currency',     'USD'),
  ('currency_cycle',       '["USD","TRY","EUR"]'),
  ('sound_enabled',        'true'),
  ('refresh_interval_min', '5'),
  ('auto_backup',          'true');
