-- Personen bleiben über die Jahre erhalten
CREATE TABLE people (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  color      TEXT    NOT NULL DEFAULT '#C42F45',
  about      TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Eine Runde = eine Liste (später "Gruppe")
CREATE TABLE rounds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL,
  year          INTEGER NOT NULL,
  budget_min    INTEGER,
  budget_max    INTEGER,
  exchange_date TEXT,
  is_current    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE round_members (
  round_id  INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (round_id, person_id)
);

-- Geschenkideen auf dem Wunschzettel einer Person
CREATE TABLE items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id   INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  url        TEXT    NOT NULL DEFAULT '',
  title      TEXT    NOT NULL DEFAULT '',
  image      TEXT    NOT NULL DEFAULT '',
  price      TEXT    NOT NULL DEFAULT '',
  site       TEXT    NOT NULL DEFAULT '',
  comment    TEXT    NOT NULL DEFAULT '',
  favorite   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_items_round_person ON items(round_id, person_id);

-- Startdaten
INSERT INTO people (name, color) VALUES
  ('Eric',  '#C42F45'),
  ('Dana',  '#2F7A5A'),
  ('Fine',  '#E3A82B'),
  ('Mika',  '#3B7BBF'),
  ('Alwin', '#7A3E8E'),
  ('Silke', '#E07A93');

INSERT INTO rounds (title, year, exchange_date, is_current)
VALUES ('Weihnachten 2026', 2026, '2026-12-24', 1);

INSERT INTO round_members (round_id, person_id)
SELECT 1, id FROM people;
