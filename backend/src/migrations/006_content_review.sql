ALTER TABLE lyric_annotation ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (review_status IN ('pending', 'approved', 'rejected', 'needs_revision'));
ALTER TABLE lyric_annotation ADD COLUMN review_note TEXT;
ALTER TABLE lyric_annotation ADD COLUMN reviewed_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL;
ALTER TABLE lyric_annotation ADD COLUMN reviewed_at TEXT;

CREATE INDEX idx_lyric_review_status ON lyric(review_status, created_at DESC);
CREATE INDEX idx_annotation_review_status ON lyric_annotation(review_status, created_at DESC);
