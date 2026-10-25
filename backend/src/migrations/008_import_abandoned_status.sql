CREATE TABLE import_session_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requested_by INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'uploading', 'processing', 'ready', 'committed', 'failed', 'abandoned')),
    detected_metadata_json TEXT NOT NULL DEFAULT '{}',
    matched_files_json TEXT NOT NULL DEFAULT '[]',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO import_session_v2(
    id, requested_by, status, detected_metadata_json, matched_files_json,
    error_message, created_at, updated_at
)
SELECT
    id, requested_by, status, detected_metadata_json, matched_files_json,
    error_message, created_at, updated_at
FROM import_session;

DROP TABLE import_session;
ALTER TABLE import_session_v2 RENAME TO import_session;
