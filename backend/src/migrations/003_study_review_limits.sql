ALTER TABLE review_log ADD COLUMN was_new INTEGER NOT NULL DEFAULT 0 CHECK (was_new IN (0, 1));

CREATE INDEX idx_review_log_user_day ON review_log(user_id, reviewed_at, was_new);
