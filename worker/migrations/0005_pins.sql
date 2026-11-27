-- 4-stellige Codes pro Person, damit niemand auf fremde Wunschzettel schauen
-- (und dort Kauf-Markierungen sehen) kann. Jede Person legt ihren Code beim ersten
-- Anmelden selbst fest. Eric sieht die Codes in der Verwaltung und kann sie zurücksetzen.
ALTER TABLE people ADD COLUMN pin TEXT;
ALTER TABLE people ADD COLUMN pin_set_at TEXT;
ALTER TABLE people ADD COLUMN pin_fails INTEGER NOT NULL DEFAULT 0;
ALTER TABLE people ADD COLUMN pin_locked_until INTEGER;
ALTER TABLE people ADD COLUMN pin_reveals INTEGER NOT NULL DEFAULT 0;
ALTER TABLE people ADD COLUMN pin_revealed_at TEXT;
