ALTER TABLE play_history ADD COLUMN last_position_seconds REAL;
ALTER TABLE play_history ADD COLUMN playlist_id INTEGER REFERENCES playlist(id) ON DELETE SET NULL;

DELETE FROM play_history
WHERE id NOT IN (
    SELECT id
    FROM (
        SELECT
            id,
            ROW_NUMBER() OVER (
                PARTITION BY user_id, song_id
                ORDER BY datetime(played_at) DESC, id DESC
            ) AS row_number
        FROM play_history
    ) ranked
    WHERE row_number = 1
);

CREATE UNIQUE INDEX idx_history_user_song ON play_history(user_id, song_id);
CREATE INDEX idx_history_playlist ON play_history(playlist_id);
