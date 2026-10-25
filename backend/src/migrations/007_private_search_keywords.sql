DROP TABLE search_keyword_stat;

CREATE TABLE search_keyword_stat (
    user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL COLLATE NOCASE,
    search_count INTEGER NOT NULL DEFAULT 0,
    last_searched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, keyword)
);

CREATE INDEX idx_search_keyword_user_popular
    ON search_keyword_stat(user_id, search_count DESC, last_searched_at DESC);
