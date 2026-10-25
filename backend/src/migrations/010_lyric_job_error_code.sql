ALTER TABLE lyric_processing_job ADD COLUMN error_code TEXT;

CREATE INDEX idx_lyric_processing_job_error_code
ON lyric_processing_job(error_code)
WHERE error_code IS NOT NULL;
