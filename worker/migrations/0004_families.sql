-- Familien und Gruppen
-- Eine Familie (z. B. "Goldenstein", "Kebel") hat Personen und beliebig viele Gruppen.
-- Eine Gruppe ist eine Runde (Tabelle rounds) mit Name und Jahr, z. B. "Weihnachten Kebel 26".
-- Personen sind familienübergreifend: Wer in zwei Familien ist, hat ein "Gut zu wissen",
-- aber pro Gruppe einen eigenen Wunschzettel.

CREATE TABLE IF NOT EXISTS families (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS family_members (
  family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (family_id, person_id)
);

-- is_current bedeutet ab jetzt "aktiv": Es können mehrere Gruppen gleichzeitig aktiv sein.
ALTER TABLE rounds ADD COLUMN family_id INTEGER REFERENCES families(id);

INSERT OR IGNORE INTO families (name, sort) VALUES ('Goldenstein', 1), ('Kebel', 2);

-- Alles Bisherige gehört zur Familie Goldenstein
UPDATE rounds SET family_id = (SELECT id FROM families WHERE name = 'Goldenstein') WHERE family_id IS NULL;
INSERT OR IGNORE INTO family_members (family_id, person_id)
  SELECT (SELECT id FROM families WHERE name = 'Goldenstein'), id FROM people;

-- Familie Kebel (Eric und Dana gibt es schon)
INSERT OR IGNORE INTO people (name, color) VALUES
  ('Wiebke',   '#D9682B'),
  ('Marco',    '#1F6F78'),
  ('Lena',     '#E07A93'),
  ('Kristina', '#7A3E8E'),
  ('Kevin',    '#3B7BBF'),
  ('Jason',    '#5C6B2E'),
  ('David',    '#E3A82B');
INSERT OR IGNORE INTO family_members (family_id, person_id)
  SELECT (SELECT id FROM families WHERE name = 'Kebel'), id FROM people
  WHERE name IN ('Eric', 'Dana', 'Wiebke', 'Marco', 'Lena', 'Kristina', 'Kevin', 'Jason', 'David');

CREATE INDEX IF NOT EXISTS idx_rounds_family ON rounds(family_id);
