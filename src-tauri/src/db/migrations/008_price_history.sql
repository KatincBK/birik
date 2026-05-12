-- 008: Tarihsel fiyat cache — varlık başına grafik verisi
--
-- range: '1d' | '1w' | '1m' | '3m' | '1y' | 'max'
-- data: JSON dizi, her eleman [timestamp_ms, price]
-- TTL fetched_at'a göre command tarafında uygulanır:
--   1d  → 5 dk
--   1w/1m → 1 saat
--   3m+ → 24 saat (geçmiş veri değişmez ama yeni nokta gün başında eklenir)

CREATE TABLE IF NOT EXISTS price_history (
  asset_id    INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  range       TEXT NOT NULL,
  data        TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (asset_id, range)
);

CREATE INDEX IF NOT EXISTS idx_price_history_fetched ON price_history(fetched_at);
