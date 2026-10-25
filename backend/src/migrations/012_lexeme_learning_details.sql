ALTER TABLE lexeme ADD COLUMN reading_katakana TEXT;
ALTER TABLE lexeme ADD COLUMN romaji TEXT;
ALTER TABLE lexeme ADD COLUMN example_ja TEXT;
ALTER TABLE lexeme ADD COLUMN example_zh TEXT;

ALTER TABLE user_lexeme_override ADD COLUMN reading_katakana TEXT;
ALTER TABLE user_lexeme_override ADD COLUMN romaji TEXT;
ALTER TABLE user_lexeme_override ADD COLUMN example_ja TEXT;
ALTER TABLE user_lexeme_override ADD COLUMN example_zh TEXT;
