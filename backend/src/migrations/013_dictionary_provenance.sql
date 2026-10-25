ALTER TABLE lexeme ADD COLUMN dictionary_source TEXT;
ALTER TABLE lexeme ADD COLUMN dictionary_entry_id TEXT;
ALTER TABLE lexeme ADD COLUMN selected_sense_index INTEGER CHECK (selected_sense_index IS NULL OR selected_sense_index >= 0);
ALTER TABLE lexeme ADD COLUMN dictionary_version TEXT;
ALTER TABLE lexeme ADD COLUMN resolution_status TEXT NOT NULL DEFAULT 'unresolved' CHECK (resolution_status IN ('resolved', 'ambiguous', 'unresolved'));

ALTER TABLE lyric_token ADD COLUMN basic_form TEXT;
ALTER TABLE lyric_token ADD COLUMN reading_katakana TEXT;
ALTER TABLE lyric_token ADD COLUMN part_of_speech TEXT;
ALTER TABLE lyric_token ADD COLUMN conjugated_type TEXT;
ALTER TABLE lyric_token ADD COLUMN conjugated_form TEXT;

CREATE INDEX idx_lexeme_dictionary_entry ON lexeme(dictionary_source, dictionary_entry_id);
CREATE INDEX idx_lyric_token_lexeme ON lyric_token(lexeme_id);
