import type { AuthUser } from './auth.js'
import type { SqliteDatabase } from './db.js'
import { nowIso } from './db.js'
import { assertApp } from './errors.js'
import { normalizeImageUri } from './media.js'
import type { SongService } from './songs.js'

export class LibraryService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly songs: SongService,
  ) {}

  listFavorites(user: AuthUser, page: number, pageSize: number) {
    page = Math.max(1, page)
    pageSize = Math.min(100, Math.max(1, pageSize))
    const total = this.database.prepare('SELECT count(*) AS count FROM user_favorite_song WHERE user_id = ?').get(user.id) as { count: number }
    const rows = this.database.prepare(`
      SELECT song_id, created_at FROM user_favorite_song WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(user.id, pageSize, (page - 1) * pageSize) as Array<{ song_id: number; created_at: string }>
    return {
      data: rows.flatMap((row) => {
        try { return [{ ...this.songs.summary(user, row.song_id), favoritedAt: row.created_at }] } catch { return [] }
      }),
      pagination: { page, page_size: pageSize, total: total.count },
    }
  }

  addFavorite(user: AuthUser, songId: number): void {
    this.songs.assertVisible(user, songId)
    this.database.prepare('INSERT OR IGNORE INTO user_favorite_song(user_id, song_id) VALUES (?, ?)').run(user.id, songId)
    this.event(user.id, 'favorite_add', 'song', songId)
  }

  removeFavorite(user: AuthUser, songId: number): void {
    this.database.prepare('DELETE FROM user_favorite_song WHERE user_id = ? AND song_id = ?').run(user.id, songId)
  }

  listHistory(user: AuthUser, page: number, pageSize: number) {
    page = Math.max(1, page)
    pageSize = Math.min(100, Math.max(1, pageSize))
    const total = this.database.prepare('SELECT count(*) AS count FROM play_history WHERE user_id = ?').get(user.id) as { count: number }
    const rows = this.database.prepare(`
      SELECT ph.*, p.name AS playlist_name
      FROM play_history ph
      LEFT JOIN playlist p ON p.id = ph.playlist_id AND p.user_id = ph.user_id
      WHERE ph.user_id = ?
      ORDER BY ph.played_at DESC
      LIMIT ? OFFSET ?
    `).all(user.id, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>
    return {
      data: rows.flatMap((row) => {
        try {
          return [{
            id: row.id, song: this.songs.summary(user, Number(row.song_id)), playedAt: row.played_at,
            playDurationSeconds: row.play_duration_seconds ?? undefined, completionRate: row.completion_rate ?? undefined,
            lastPositionSeconds: row.last_position_seconds ?? undefined,
            playlist: row.playlist_id && row.playlist_name
              ? { id: Number(row.playlist_id), name: String(row.playlist_name) }
              : undefined,
          }]
        } catch { return [] }
      }),
      pagination: { page, page_size: pageSize, total: total.count },
    }
  }

  addHistory(user: AuthUser, input: { songId: number; playedAt?: string; duration?: number; completionRate?: number; lastPosition?: number; playlistId?: number | null; started?: boolean }): void {
    assertApp(Number.isInteger(input.songId) && input.songId > 0, 400, 'invalid_song_id', '歌曲编号无效')
    assertApp(input.duration === undefined || (Number.isFinite(input.duration) && input.duration >= 0), 400, 'invalid_play_duration', '播放时长无效')
    assertApp(input.completionRate === undefined || (Number.isFinite(input.completionRate) && input.completionRate >= 0 && input.completionRate <= 1), 400, 'invalid_completion_rate', '播放完成率应在 0 到 1 之间')
    assertApp(input.lastPosition === undefined || (Number.isFinite(input.lastPosition) && input.lastPosition >= 0), 400, 'invalid_play_position', '播放位置无效')
    assertApp(input.playlistId === undefined || input.playlistId === null || (Number.isInteger(input.playlistId) && input.playlistId > 0), 400, 'invalid_playlist_id', '歌单编号无效')
    this.songs.assertVisible(user, input.songId)
    const playedAt = input.playedAt && !Number.isNaN(Date.parse(input.playedAt)) ? input.playedAt : nowIso()
    const playlistId = input.playlistId
      ? (this.database.prepare(`
          SELECT p.id
          FROM playlist p
          JOIN playlist_song ps ON ps.playlist_id = p.id
          WHERE p.id = ? AND p.user_id = ? AND ps.song_id = ?
        `).get(input.playlistId, user.id, input.songId) as { id: number } | undefined)?.id ?? null
      : null
    this.database.prepare(`
      INSERT INTO play_history(
        user_id, song_id, played_at, play_duration_seconds, completion_rate, last_position_seconds, playlist_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, song_id) DO UPDATE SET
        played_at = excluded.played_at,
        play_duration_seconds = excluded.play_duration_seconds,
        completion_rate = excluded.completion_rate,
        last_position_seconds = excluded.last_position_seconds,
        playlist_id = excluded.playlist_id
      WHERE julianday(excluded.played_at) >= julianday(play_history.played_at)
    `).run(
      user.id,
      input.songId,
      playedAt,
      input.duration ?? null,
      input.completionRate ?? null,
      input.lastPosition ?? null,
      playlistId,
    )
    if (input.started !== false) {
      this.event(user.id, 'play', 'song', input.songId, {
        duration: input.duration,
        completionRate: input.completionRate,
        lastPosition: input.lastPosition,
        playlistId,
      })
    }
  }

  listPlaylists(user: AuthUser) {
    const rows = this.database.prepare(`
      SELECT p.*,
        (SELECT count(*) FROM playlist_song ps WHERE ps.playlist_id = p.id) AS song_count,
        COALESCE(NULLIF(p.cover_url, ''), (
          SELECT s.cover_url FROM playlist_song ps
          JOIN song s ON s.id = ps.song_id
          WHERE ps.playlist_id = p.id AND s.cover_url IS NOT NULL AND trim(s.cover_url) <> ''
          ORDER BY ps.position LIMIT 1
        )) AS effective_cover_url
      FROM playlist p WHERE p.user_id = ? OR p.visibility = 'shared' ORDER BY p.updated_at DESC
    `).all(user.id) as Array<Record<string, unknown>>
    return rows.map((row) => this.serializePlaylist(row))
  }

  createPlaylist(user: AuthUser, input: { name: string; description?: string; coverUrl?: string; visibility?: string }) {
    assertApp(input.name.trim(), 400, 'playlist_name_required', '请输入歌单名称')
    const result = this.database.prepare(`
      INSERT INTO playlist(user_id, name, description, cover_url, visibility) VALUES (?, ?, ?, ?, ?)
    `).run(user.id, input.name.trim(), input.description?.trim() || null, input.coverUrl ? normalizeImageUri(input.coverUrl) || null : null, input.visibility === 'public' ? 'shared' : 'private')
    return this.getPlaylistBase(Number(result.lastInsertRowid))
  }

  playlistDetail(user: AuthUser, playlistId: number) {
    const base = this.getPlaylistBase(playlistId)
    assertApp(base.userId === user.id || base.visibility === 'public', 404, 'playlist_not_found', '歌单不存在')
    const rows = this.database.prepare(`SELECT * FROM playlist_song WHERE playlist_id = ? ORDER BY position`).all(playlistId) as Array<Record<string, unknown>>
    return {
      ...base,
      songs: rows.flatMap((row) => {
        try { return [{ song: this.songs.summary(user, Number(row.song_id)), position: row.position, addedAt: row.created_at }] } catch { return [] }
      }),
    }
  }

  updatePlaylist(user: AuthUser, playlistId: number, input: { name?: string; description?: string; coverUrl?: string; visibility?: string }) {
    const current = this.requirePlaylistOwner(user, playlistId)
    if(input.name!==undefined) assertApp(input.name.trim().length>0&&input.name.trim().length<=120,400,'invalid_playlist_name','歌单名称需要 1 至 120 个字符')
    if (input.visibility === 'public') {
      assertApp(!this.database.prepare("SELECT 1 FROM playlist_song ps JOIN song s ON s.id=ps.song_id WHERE ps.playlist_id=? AND (s.visibility!='shared' OR s.review_status!='approved') LIMIT 1").get(playlistId),400,'private_songs','歌单含私人歌曲，不能公开')
    }
    this.database.prepare(`
      UPDATE playlist SET name = ?, description = ?, cover_url = ?, visibility = ?, updated_at = ? WHERE id = ?
    `).run(
      input.name?.trim() || current.name, input.description === undefined ? current.description ?? null : input.description.trim() || null,
      input.coverUrl === undefined ? current.coverUrl ?? null : normalizeImageUri(input.coverUrl) || null,
      (input.visibility ?? current.visibility) === 'public' ? 'shared' : 'private',
      nowIso(), playlistId,
    )
    return this.playlistDetail(user, playlistId)
  }

  deletePlaylist(user: AuthUser, playlistId: number): void {
    this.requirePlaylistOwner(user, playlistId)
    this.database.prepare('DELETE FROM playlist WHERE id = ?').run(playlistId)
  }

  addPlaylistSong(user: AuthUser, playlistId: number, songId: number, position?: number): void {
    const base = this.getPlaylistBase(playlistId)
    if (base.userId !== user.id && base.visibility === 'public') {
      this.addPlaylistSongs(user, playlistId, [songId])
      return
    }
    this.requirePlaylistOwner(user, playlistId)
    assertApp(Number.isInteger(songId) && songId > 0, 400, 'invalid_song_id', '歌曲编号无效')
    assertApp(position === undefined || (Number.isInteger(position) && position > 0), 400, 'invalid_song_position', '歌单位置无效')
    this.songs.assertVisible(user, songId)
    if (base.visibility === 'public') this.requireSharedSong(songId)
    const rows = this.database.prepare('SELECT song_id FROM playlist_song WHERE playlist_id = ? ORDER BY position').all(playlistId) as Array<{ song_id: number }>
    const orderedIds = rows.map((row) => row.song_id).filter((id) => id !== songId)
    const targetIndex = position === undefined ? orderedIds.length : Math.min(position - 1, orderedIds.length)
    orderedIds.splice(targetIndex, 0, songId)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('INSERT OR IGNORE INTO playlist_song(playlist_id, song_id, position) VALUES (?, ?, ?)').run(playlistId, songId, -(orderedIds.length + 1))
      this.writePlaylistOrder(playlistId, orderedIds)
      this.database.prepare('UPDATE playlist SET updated_at = ? WHERE id = ?').run(nowIso(), playlistId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    this.event(user.id, 'playlist_song_add', 'song', songId, { playlistId })
  }

  removePlaylistSong(user: AuthUser, playlistId: number, songId: number): void {
    this.requirePlaylistOwner(user, playlistId)
    this.database.prepare('DELETE FROM playlist_song WHERE playlist_id = ? AND song_id = ?').run(playlistId, songId)
    this.normalizePositions(playlistId)
  }

  reorderPlaylist(user: AuthUser, playlistId: number, songIds: number[]): void {
    this.requirePlaylistOwner(user, playlistId)
    const current = this.database.prepare('SELECT song_id FROM playlist_song WHERE playlist_id = ? ORDER BY position').all(playlistId) as Array<{ song_id: number }>
    assertApp(songIds.every((id) => Number.isInteger(id) && id > 0) && current.length === songIds.length && new Set(songIds).size === songIds.length && current.every((row) => songIds.includes(row.song_id)), 400, 'invalid_song_order', '歌曲顺序与歌单内容不一致')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.writePlaylistOrder(playlistId, songIds)
      this.database.prepare('UPDATE playlist SET updated_at = ? WHERE id = ?').run(nowIso(), playlistId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private getPlaylistBase(id: number) {
    const row = this.database.prepare(`
      SELECT p.*,
        (SELECT count(*) FROM playlist_song ps WHERE ps.playlist_id = p.id) AS song_count,
        COALESCE(NULLIF(p.cover_url, ''), (
          SELECT s.cover_url FROM playlist_song ps
          JOIN song s ON s.id = ps.song_id
          WHERE ps.playlist_id = p.id AND s.cover_url IS NOT NULL AND trim(s.cover_url) <> ''
          ORDER BY ps.position LIMIT 1
        )) AS effective_cover_url
      FROM playlist p WHERE p.id = ?
    `).get(id) as Record<string, unknown> | undefined
    assertApp(row, 404, 'playlist_not_found', '歌单不存在')
    return this.serializePlaylist(row)
  }

  private serializePlaylist(row: Record<string, unknown>) {
    return {
      id: row.id as number, userId: row.user_id as number, name: row.name as string,
      description: row.description ? String(row.description) : undefined,
      coverUrl: row.effective_cover_url ? String(row.effective_cover_url) : (row.cover_url ? String(row.cover_url) : undefined),
      visibility: row.visibility === 'shared' ? 'public' : 'private', songCount: Number(row.song_count ?? 0),
      createdAt: row.created_at, updatedAt: row.updated_at,
    }
  }

  requirePlaylistOwner(user: AuthUser, playlistId: number) {
    const playlist = this.getPlaylistBase(playlistId)
    assertApp(playlist.userId === user.id, 403, 'forbidden', '不能修改其他用户的歌单')
    return playlist
  }

  requirePlaylistContributor(user: AuthUser, playlistId: number) {
    assertApp(Number.isSafeInteger(playlistId)&&playlistId>0,400,'invalid_playlist','请选择有效歌单')
    const playlist = this.getPlaylistBase(playlistId)
    assertApp(playlist.userId === user.id || playlist.visibility === 'public',403,'forbidden','不能添加到其他用户的私人歌单')
    return playlist
  }

  private requireSharedSong(songId: number) {
    assertApp(this.database.prepare("SELECT 1 FROM song WHERE id=? AND visibility='shared' AND review_status='approved'").get(songId),400,'private_song','公共歌单只能加入公共曲库中的歌曲')
  }

  addPlaylistSongs(user: AuthUser, playlistId: number, songIds: number[]) {
    const playlist = this.requirePlaylistContributor(user, playlistId)
    assertApp(Array.isArray(songIds) && songIds.length > 0 && songIds.every(id=>Number.isSafeInteger(id)&&id>0),400,'invalid_songs','请选择歌曲')
    const ids = [...new Set(songIds)]
    for (const id of ids) {
      this.songs.assertVisible(user,id)
      if (playlist.visibility === 'public') this.requireSharedSong(id)
    }
    let added = 0
    this.database.exec('BEGIN IMMEDIATE')
    try {
      let position = Number(this.database.prepare('SELECT coalesce(max(position),0) AS n FROM playlist_song WHERE playlist_id=?').get(playlistId)!.n)
      for (const id of ids) {
        if (this.database.prepare('SELECT 1 FROM playlist_song WHERE playlist_id=? AND song_id=?').get(playlistId,id)) continue
        this.database.prepare('INSERT INTO playlist_song(playlist_id,song_id,position) VALUES (?,?,?)').run(playlistId,id,++position)
        added++
      }
      this.database.prepare('UPDATE playlist SET updated_at=? WHERE id=?').run(nowIso(),playlistId)
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
    return { added, existing: ids.length-added }
  }

  private normalizePositions(playlistId: number): void {
    const rows = this.database.prepare('SELECT song_id FROM playlist_song WHERE playlist_id = ? ORDER BY position').all(playlistId) as Array<{ song_id: number }>
    this.writePlaylistOrder(playlistId, rows.map((row) => row.song_id))
  }

  private writePlaylistOrder(playlistId: number, songIds: number[]): void {
    const update = this.database.prepare('UPDATE playlist_song SET position = ? WHERE playlist_id = ? AND song_id = ?')
    songIds.forEach((songId, index) => update.run(-(index + 1), playlistId, songId))
    songIds.forEach((songId, index) => update.run(index + 1, playlistId, songId))
  }

  private event(userId: number, eventType: string, subjectType?: string, subjectId?: number, metadata: Record<string, unknown> = {}): void {
    this.database.prepare(`
      INSERT INTO behavior_event(user_id, event_type, subject_type, subject_id, metadata_json) VALUES (?, ?, ?, ?, ?)
    `).run(userId, eventType, subjectType ?? null, subjectId ?? null, JSON.stringify(metadata))
  }
}
