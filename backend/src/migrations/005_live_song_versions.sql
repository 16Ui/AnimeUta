ALTER TABLE song RENAME COLUMN version_type TO version_type_legacy;
ALTER TABLE song ADD COLUMN version_type TEXT CHECK (version_type IS NULL OR version_type IN ('full', 'tv_size', 'instrumental', 'cover', 'live', 'ost', 'variation'));
UPDATE song SET version_type = version_type_legacy;
