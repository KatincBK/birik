-- 006: Profil sistemi
--
-- NOT: SQLite "ALTER TABLE ADD COLUMN ... REFERENCES ... DEFAULT ..." kombosunu
-- desteklemiyor. Bu yüzden FK constraint'ini DDL'de değil, uygulama
-- seviyesinde (delete_profile komutu) manuel cascade ile yönetiyoruz.

CREATE TABLE IF NOT EXISTS profiles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- Default profil — id=1 sabit
INSERT OR IGNORE INTO profiles (id, name, created_at)
VALUES (1, 'Profil 1', strftime('%s','now'));

-- portfolios.profile_id — REFERENCES yok (ALTER kısıtı), uygulama seviyesinde cascade
ALTER TABLE portfolios ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1;

-- budgets.profile_id — nullable
ALTER TABLE budgets ADD COLUMN profile_id INTEGER;

-- Mevcut bütçelerin İLKİNİ Profil 1'e bağla, gerisini orphan bırak
UPDATE budgets SET profile_id = 1 WHERE id = (SELECT MIN(id) FROM budgets);

-- Profil başına en fazla 1 bütçe
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_profile
ON budgets(profile_id) WHERE profile_id IS NOT NULL;

-- Hızlı sorgular için
CREATE INDEX IF NOT EXISTS idx_portfolios_profile ON portfolios(profile_id);
