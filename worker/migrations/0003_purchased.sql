-- "Schon gekauft"-Markierung (für die beschenkte Person unsichtbar)
ALTER TABLE items ADD COLUMN purchased_by INTEGER;
ALTER TABLE items ADD COLUMN purchased_at TEXT;
