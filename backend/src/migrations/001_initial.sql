CREATE TABLE app_user (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    bio TEXT,
    preferred_language TEXT NOT NULL DEFAULT 'zh-CN',
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'user')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth_session (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    access_token_hash TEXT NOT NULL UNIQUE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    access_expires_at TEXT NOT NULL,
    refresh_expires_at TEXT NOT NULL,
    revoked_at TEXT,
    device_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE invite_code (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hash TEXT NOT NULL UNIQUE,
    created_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
    max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
    used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    expires_at TEXT,
    disabled_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE publisher (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    name_ja TEXT,
    name_en TEXT,
    website_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE label (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    publisher_id INTEGER REFERENCES publisher(id) ON DELETE SET NULL,
    name TEXT NOT NULL UNIQUE,
    name_ja TEXT,
    name_en TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE artist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_ja TEXT,
    name_zh TEXT,
    name_en TEXT,
    name_romaji TEXT,
    artist_type TEXT,
    country_code TEXT,
    avatar_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (coalesce(name_ja, name_zh, name_en, name_romaji) IS NOT NULL)
);

CREATE TABLE work (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_ja TEXT,
    title_zh TEXT,
    title_en TEXT,
    title_romaji TEXT,
    work_type TEXT,
    release_date TEXT,
    season_label TEXT,
    cover_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (coalesce(title_ja, title_zh, title_en, title_romaji) IS NOT NULL)
);

CREATE TABLE album (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_ja TEXT,
    title_zh TEXT,
    title_en TEXT,
    title_romaji TEXT,
    album_type TEXT,
    release_date TEXT,
    catalog_no TEXT,
    cover_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (coalesce(title_ja, title_zh, title_en, title_romaji) IS NOT NULL)
);

CREATE TABLE creator (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    name_ja TEXT,
    name_en TEXT,
    name_romaji TEXT,
    creator_type TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE acg_character (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER REFERENCES work(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    name_ja TEXT,
    name_zh TEXT,
    name_en TEXT,
    name_romaji TEXT,
    description TEXT,
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE voice_actor (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    name_ja TEXT,
    name_zh TEXT,
    name_en TEXT,
    name_romaji TEXT,
    avatar_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE song_version_group (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_title TEXT NOT NULL,
    work_id INTEGER REFERENCES work(id) ON DELETE SET NULL,
    canonical_song_id INTEGER,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE song (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_ja TEXT,
    title_zh TEXT,
    title_en TEXT,
    title_romaji TEXT,
    duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    language_code TEXT NOT NULL DEFAULT 'ja',
    release_date TEXT,
    cover_url TEXT,
    audio_source_type TEXT NOT NULL DEFAULT 'local_upload',
    audio_source_uri TEXT,
    audio_mime_type TEXT,
    audio_size_bytes INTEGER,
    audio_checksum TEXT,
    submitted_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
    review_status TEXT NOT NULL DEFAULT 'approved' CHECK (review_status IN ('pending', 'approved', 'rejected', 'needs_revision')),
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
    review_note TEXT,
    version_group_id INTEGER REFERENCES song_version_group(id) ON DELETE SET NULL,
    version_type TEXT CHECK (version_type IS NULL OR version_type IN ('full', 'tv_size', 'instrumental', 'cover', 'ost', 'variation')),
    publisher_id INTEGER REFERENCES publisher(id) ON DELETE SET NULL,
    label_id INTEGER REFERENCES label(id) ON DELETE SET NULL,
    source_metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (coalesce(title_ja, title_zh, title_en, title_romaji) IS NOT NULL)
);

CREATE TABLE song_artist (
    song_id INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    artist_id INTEGER NOT NULL REFERENCES artist(id) ON DELETE CASCADE,
    artist_role TEXT NOT NULL DEFAULT 'primary',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (song_id, artist_id, artist_role)
);

CREATE TABLE song_work (
    song_id INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    work_id INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL DEFAULT 'theme_song',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (song_id, work_id, relation_type)
);

CREATE TABLE album_song (
    album_id INTEGER NOT NULL REFERENCES album(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    disc_no INTEGER NOT NULL DEFAULT 1,
    track_no INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (album_id, song_id)
);

CREATE TABLE song_creator (
    song_id INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    creator_id INTEGER NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (song_id, creator_id, role)
);

CREATE TABLE character_voice_actor (
    character_id INTEGER NOT NULL REFERENCES acg_character(id) ON DELETE CASCADE,
    voice_actor_id INTEGER NOT NULL REFERENCES voice_actor(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (character_id, voice_actor_id)
);

CREATE TABLE song_character (
    song_id INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES acg_character(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL DEFAULT 'character_song',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (song_id, character_id, relation_type)
);

CREATE TABLE song_alias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    alias_text TEXT NOT NULL,
    alias_type TEXT,
    language_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (song_id, alias_text)
);

CREATE TABLE artist_alias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_id INTEGER NOT NULL REFERENCES artist(id) ON DELETE CASCADE,
    alias_text TEXT NOT NULL,
    alias_type TEXT,
    language_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (artist_id, alias_text)
);

CREATE TABLE work_alias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
    alias_text TEXT NOT NULL,
    alias_type TEXT,
    language_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (work_id, alias_text)
);

CREATE TABLE import_session (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requested_by INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'uploading', 'processing', 'ready', 'committed', 'failed')),
    detected_metadata_json TEXT NOT NULL DEFAULT '{}',
    matched_files_json TEXT NOT NULL DEFAULT '[]',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lyric (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    language_code TEXT NOT NULL DEFAULT 'ja',
    source_type TEXT NOT NULL DEFAULT 'user_upload',
    original_text TEXT NOT NULL DEFAULT '',
    review_status TEXT NOT NULL DEFAULT 'approved' CHECK (review_status IN ('pending', 'approved', 'rejected', 'needs_revision')),
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
    is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
    version_label TEXT,
    source_ref TEXT,
    review_note TEXT,
    uploaded_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
    reviewed_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lyric_line (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lyric_id INTEGER NOT NULL REFERENCES lyric(id) ON DELETE CASCADE,
    line_index INTEGER NOT NULL,
    start_ms INTEGER CHECK (start_ms IS NULL OR start_ms >= 0),
    end_ms INTEGER CHECK (end_ms IS NULL OR end_ms >= 0),
    original_text TEXT NOT NULL,
    translated_text TEXT,
    ruby_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (lyric_id, line_index)
);

CREATE TABLE lyric_annotation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lyric_id INTEGER NOT NULL REFERENCES lyric(id) ON DELETE CASCADE,
    line_id INTEGER REFERENCES lyric_line(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('note', 'grammar', 'vocabulary', 'translation', 'timing', 'culture')),
    body TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('private', 'shared')),
    annotation_scope TEXT NOT NULL DEFAULT 'learning' CHECK (annotation_scope IN ('learning', 'admin_review')),
    created_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lyric_processing_job (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    lyric_id INTEGER REFERENCES lyric(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL CHECK (job_type IN ('transcribe', 'translate', 'furigana', 'align', 'annotate', 'tokenize')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
    input_payload_json TEXT NOT NULL DEFAULT '{}',
    output_payload_json TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    requested_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lexeme (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    language_code TEXT NOT NULL DEFAULT 'ja',
    lemma TEXT NOT NULL,
    writing TEXT NOT NULL,
    reading TEXT,
    part_of_speech TEXT,
    meaning_zh TEXT,
    meaning_en TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (language_code, lemma, writing, reading)
);

CREATE TABLE lyric_token (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_id INTEGER NOT NULL REFERENCES lyric_line(id) ON DELETE CASCADE,
    lexeme_id INTEGER REFERENCES lexeme(id) ON DELETE SET NULL,
    token_index INTEGER NOT NULL,
    surface TEXT NOT NULL,
    start_offset INTEGER,
    end_offset INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (line_id, token_index)
);

CREATE TABLE study_deck (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    source_song_id INTEGER REFERENCES song(id) ON DELETE SET NULL,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE study_card (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    deck_id INTEGER NOT NULL REFERENCES study_deck(id) ON DELETE CASCADE,
    lexeme_id INTEGER NOT NULL REFERENCES lexeme(id) ON DELETE CASCADE,
    source_song_id INTEGER REFERENCES song(id) ON DELETE SET NULL,
    source_line_id INTEGER REFERENCES lyric_line(id) ON DELETE SET NULL,
    direction TEXT NOT NULL CHECK (direction IN ('ja_zh', 'zh_ja')),
    state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review', 'suspended')),
    due_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    stability REAL NOT NULL DEFAULT 0,
    difficulty REAL NOT NULL DEFAULT 5,
    repetitions INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, deck_id, lexeme_id, direction)
);

CREATE TABLE review_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES study_card(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 4),
    reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    elapsed_days REAL NOT NULL DEFAULT 0,
    scheduled_days REAL NOT NULL DEFAULT 0,
    due_before TEXT NOT NULL,
    due_after TEXT NOT NULL
);

CREATE TABLE playlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    cover_url TEXT,
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE playlist_song (
    playlist_id INTEGER NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (playlist_id, song_id),
    UNIQUE (playlist_id, position)
);

CREATE TABLE user_favorite_song (
    user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, song_id)
);

CREATE TABLE play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES song(id) ON DELETE CASCADE,
    played_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    play_duration_seconds INTEGER,
    completion_rate REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE search_keyword_stat (
    keyword TEXT PRIMARY KEY COLLATE NOCASE,
    search_count INTEGER NOT NULL DEFAULT 0,
    last_searched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE behavior_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    subject_type TEXT,
    subject_id INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auth_session_access ON auth_session(access_token_hash, revoked_at, access_expires_at);
CREATE INDEX idx_auth_session_refresh ON auth_session(refresh_token_hash, revoked_at, refresh_expires_at);
CREATE INDEX idx_song_created_at ON song(created_at DESC);
CREATE INDEX idx_song_review_visibility ON song(review_status, visibility);
CREATE INDEX idx_song_artist_song_order ON song_artist(song_id, sort_order);
CREATE INDEX idx_song_work_song_order ON song_work(song_id, sort_order);
CREATE INDEX idx_album_song_album_track ON album_song(album_id, disc_no, track_no);
CREATE INDEX idx_lyric_song_current ON lyric(song_id, is_current, created_at DESC);
CREATE INDEX idx_lyric_line_order ON lyric_line(lyric_id, line_index);
CREATE INDEX idx_lyric_job_pending ON lyric_processing_job(status, created_at);
CREATE INDEX idx_lyric_token_line ON lyric_token(line_id, token_index);
CREATE INDEX idx_study_card_due ON study_card(user_id, state, due_at);
CREATE INDEX idx_review_log_user_time ON review_log(user_id, reviewed_at DESC);
CREATE INDEX idx_playlist_user ON playlist(user_id, updated_at DESC);
CREATE INDEX idx_history_user_time ON play_history(user_id, played_at DESC);
CREATE INDEX idx_event_user_time ON behavior_event(user_id, occurred_at DESC);
