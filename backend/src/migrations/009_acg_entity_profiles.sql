ALTER TABLE publisher ADD COLUMN name_zh TEXT;
ALTER TABLE publisher ADD COLUMN name_romaji TEXT;
ALTER TABLE publisher ADD COLUMN image_url TEXT;

ALTER TABLE label ADD COLUMN name_zh TEXT;
ALTER TABLE label ADD COLUMN name_romaji TEXT;
ALTER TABLE label ADD COLUMN image_url TEXT;

ALTER TABLE creator ADD COLUMN name_zh TEXT;
ALTER TABLE creator ADD COLUMN image_url TEXT;

ALTER TABLE song_version_group ADD COLUMN image_url TEXT;

CREATE TABLE creator_alias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
    alias_text TEXT NOT NULL,
    alias_type TEXT,
    language_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (creator_id, alias_text)
);

CREATE TABLE character_alias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES acg_character(id) ON DELETE CASCADE,
    alias_text TEXT NOT NULL,
    alias_type TEXT,
    language_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (character_id, alias_text)
);

CREATE TABLE voice_actor_alias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voice_actor_id INTEGER NOT NULL REFERENCES voice_actor(id) ON DELETE CASCADE,
    alias_text TEXT NOT NULL,
    alias_type TEXT,
    language_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (voice_actor_id, alias_text)
);

CREATE TABLE publisher_alias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    publisher_id INTEGER NOT NULL REFERENCES publisher(id) ON DELETE CASCADE,
    alias_text TEXT NOT NULL,
    alias_type TEXT,
    language_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (publisher_id, alias_text)
);

CREATE TABLE version_group_alias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_group_id INTEGER NOT NULL REFERENCES song_version_group(id) ON DELETE CASCADE,
    alias_text TEXT NOT NULL,
    alias_type TEXT,
    language_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (version_group_id, alias_text)
);

CREATE TABLE label_alias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label_id INTEGER NOT NULL REFERENCES label(id) ON DELETE CASCADE,
    alias_text TEXT NOT NULL,
    alias_type TEXT,
    language_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (label_id, alias_text)
);

CREATE INDEX idx_creator_alias_text ON creator_alias(alias_text COLLATE NOCASE);
CREATE INDEX idx_character_alias_text ON character_alias(alias_text COLLATE NOCASE);
CREATE INDEX idx_voice_actor_alias_text ON voice_actor_alias(alias_text COLLATE NOCASE);
CREATE INDEX idx_publisher_alias_text ON publisher_alias(alias_text COLLATE NOCASE);
CREATE INDEX idx_label_alias_text ON label_alias(alias_text COLLATE NOCASE);
CREATE INDEX idx_version_group_alias_text ON version_group_alias(alias_text COLLATE NOCASE);
