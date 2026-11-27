-- 4-stellige Codes pro Person, damit niemand auf fremde Wunschzettel schauen
-- (und dort Kauf-Markierungen sehen) kann. Eric sieht die Codes in der Verwaltung.
ALTER TABLE people ADD COLUMN pin TEXT;
ALTER TABLE people ADD COLUMN pin_fails INTEGER NOT NULL DEFAULT 0;
ALTER TABLE people ADD COLUMN pin_locked_until INTEGER;
ALTER TABLE people ADD COLUMN pin_reveals INTEGER NOT NULL DEFAULT 0;
ALTER TABLE people ADD COLUMN pin_revealed_at TEXT;
UPDATE people SET pin = printf('%04d', abs(random()) % 10000) WHERE pin IS NULL;
