CREATE TABLE online_catalog_cache (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  catalog_json TEXT NOT NULL,
  refreshed_at INTEGER NOT NULL
);
