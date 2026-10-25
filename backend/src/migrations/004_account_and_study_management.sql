ALTER TABLE app_user ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';

ALTER TABLE study_deck ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

CREATE TABLE user_lexeme_override (
    user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    lexeme_id INTEGER NOT NULL REFERENCES lexeme(id) ON DELETE CASCADE,
    writing TEXT,
    reading TEXT,
    part_of_speech TEXT,
    meaning_zh TEXT,
    meaning_en TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, lexeme_id)
);

CREATE TABLE album_alias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL REFERENCES album(id) ON DELETE CASCADE,
    alias_text TEXT NOT NULL,
    alias_type TEXT,
    language_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (album_id, alias_text)
);

CREATE INDEX idx_invite_code_created ON invite_code(created_at DESC);
CREATE INDEX idx_auth_session_user ON auth_session(user_id, created_at DESC);
CREATE INDEX idx_study_deck_user_order ON study_deck(user_id, sort_order, updated_at DESC);
CREATE INDEX idx_user_lexeme_override_user ON user_lexeme_override(user_id, updated_at DESC);
CREATE INDEX idx_album_alias_text ON album_alias(alias_text COLLATE NOCASE);
