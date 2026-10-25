CREATE TABLE online_source (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  checksum TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE online_source_selection (
  user_id INTEGER PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES online_source(id) ON DELETE SET NULL
);
CREATE TABLE online_download (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES online_source(id),
  track_json TEXT NOT NULL,
  track_key TEXT NOT NULL,
  quality TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  received INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  song_id INTEGER REFERENCES song(id) ON DELETE SET NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX online_download_user ON online_download(user_id, id);
