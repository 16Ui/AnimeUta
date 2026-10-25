CREATE TABLE online_download_playlist (
  download_id INTEGER NOT NULL REFERENCES online_download(id) ON DELETE CASCADE,
  playlist_id INTEGER NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  PRIMARY KEY(download_id, playlist_id, user_id)
);
