ALTER TABLE lyric ADD COLUMN review_requested_at TEXT;
ALTER TABLE lyric_annotation ADD COLUMN review_requested_at TEXT;

CREATE INDEX idx_lyric_review_request
ON lyric(review_status, review_requested_at)
WHERE review_requested_at IS NOT NULL;

CREATE INDEX idx_annotation_review_request
ON lyric_annotation(review_status, review_requested_at)
WHERE review_requested_at IS NOT NULL;
