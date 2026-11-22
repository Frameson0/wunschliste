-- Zwischenspeicher für Amazon-Suchen (spart das Gratis-Kontingent der Such-Dienste)
CREATE TABLE IF NOT EXISTS search_cache (
  key        TEXT    PRIMARY KEY,
  data       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
