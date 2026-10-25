ALTER TABLE lyric_line ADD COLUMN romaji_text TEXT;
ALTER TABLE lyric_token ADD COLUMN start_ms INTEGER CHECK (start_ms IS NULL OR start_ms >= 0);
ALTER TABLE lyric_token ADD COLUMN end_ms INTEGER CHECK (end_ms IS NULL OR end_ms >= 0);

CREATE TABLE study_preference (
    user_id INTEGER PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
    daily_new_limit INTEGER NOT NULL DEFAULT 20 CHECK (daily_new_limit BETWEEN 1 AND 200),
    daily_review_limit INTEGER NOT NULL DEFAULT 100 CHECK (daily_review_limit BETWEEN 1 AND 1000),
    default_direction TEXT NOT NULL DEFAULT 'ja_zh' CHECK (default_direction IN ('ja_zh', 'zh_ja')),
    autoplay_pronunciation INTEGER NOT NULL DEFAULT 0 CHECK (autoplay_pronunciation IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_lyric_token_time ON lyric_token(line_id, start_ms, end_ms);
