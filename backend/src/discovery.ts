import type { AuthUser } from './auth.js'
import type { AcgService } from './acg.js'
import type { SqliteDatabase } from './db.js'
import { assertApp } from './errors.js'
import type { SongService } from './songs.js'

function firstText(...values: unknown[]): string {
  return values.find((value) => typeof value === 'string' && value.trim()) as string || ''
}

export class DiscoveryService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly songs: SongService,
    private readonly acg: AcgService,
  ) {}

  search(user: AuthUser, keyword: string, page: number, pageSize: number) {
    keyword = keyword.trim()
    if (!keyword) return {
      songs: [], artists: [], works: [], albums: [], creators: [], characters: [],
      voiceActors: [], publishers: [], labels: [], versionGroups: [],
      pagination: { page: 1, page_size: Math.min(50, Math.max(1, pageSize || 20)), total: 0 },
    }
    page = Math.max(1, Math.floor(page) || 1)
    const limit = Math.min(50, Math.max(1, Math.floor(pageSize) || 20))
    const offset = (page - 1) * limit
    const pattern = `%${keyword}%`
    const songRows = this.database.prepare(`
      SELECT DISTINCT s.id FROM song s LEFT JOIN song_alias sa ON sa.song_id = s.id
      WHERE (s.title_ja LIKE ? OR s.title_zh LIKE ? OR s.title_en LIKE ? OR s.title_romaji LIKE ? OR sa.alias_text LIKE ?)
        AND ((s.review_status = 'approved' AND s.visibility = 'shared') OR s.submitted_by = ?)
      ORDER BY CASE WHEN s.title_ja = ? OR s.title_zh = ? OR s.title_en = ? OR s.title_romaji = ? THEN 0 ELSE 1 END, s.created_at DESC
      LIMIT ? OFFSET ?
    `).all(pattern, pattern, pattern, pattern, pattern, user.id, keyword, keyword, keyword, keyword, limit, offset) as Array<{ id: number }>
    const countRow = this.database.prepare(`
      SELECT count(DISTINCT s.id) AS total FROM song s LEFT JOIN song_alias sa ON sa.song_id = s.id
      WHERE (s.title_ja LIKE ? OR s.title_zh LIKE ? OR s.title_en LIKE ? OR s.title_romaji LIKE ? OR sa.alias_text LIKE ?)
        AND ((s.review_status = 'approved' AND s.visibility = 'shared') OR s.submitted_by = ?)
    `).get(pattern, pattern, pattern, pattern, pattern, user.id) as { total: number }
    return {
      songs: songRows.flatMap((row) => { try { return [this.songs.summary(user, row.id)] } catch { return [] } }),
      artists: this.searchArtists(user, pattern, limit),
      works: this.searchWorks(user, pattern, limit),
      albums: this.searchAlbums(user, pattern, limit),
      ...this.acg.search(user, pattern, limit),
      pagination: { page, page_size: limit, total: Number(countRow.total) },
    }
  }

  suggestions(user: AuthUser, keyword: string, limit: number) {
    if (!keyword.trim()) return []
    const result = this.searchWithoutRecording(user, keyword, Math.min(20, Math.max(1, limit)))
    const groups = [
      result.songs.map((item) => ({ type: 'song', id: Number(item.id), text: item.displayTitle, displayTitle: item.displayTitle })),
      result.artists.map((item) => ({ type: 'artist', id: Number(item.id), text: item.displayName, displayTitle: item.displayName })),
      result.works.map((item) => ({ type: 'work', id: Number(item.id), text: item.displayTitle, displayTitle: item.displayTitle })),
      result.albums.map((item) => ({ type: 'album', id: Number(item.id), text: item.displayTitle, displayTitle: item.displayTitle })),
      result.creators.map((item) => ({ type: 'creator', id: Number(item.id), text: item.displayName, displayTitle: item.displayName })),
      result.characters.map((item) => ({ type: 'character', id: Number(item.id), text: item.displayName, displayTitle: item.displayName })),
      result.voiceActors.map((item) => ({ type: 'voice_actor', id: Number(item.id), text: item.displayName, displayTitle: item.displayName })),
      result.publishers.map((item) => ({ type: 'publisher', id: Number(item.id), text: item.displayName, displayTitle: item.displayName })),
      result.labels.map((item) => ({ type: 'label', id: Number(item.id), text: item.displayName, displayTitle: item.displayName })),
      result.versionGroups.map((item) => ({ type: 'version_group', id: Number(item.id), text: item.displayName, displayTitle: item.displayName })),
    ]
    const suggestions: Array<{ type: string; id: number; text: string; displayTitle: string }> = []
    for (let index = 0; suggestions.length < limit; index += 1) {
      let found = false
      for (const group of groups) {
        const candidate = group[index]
        if (candidate) {
          suggestions.push(candidate)
          found = true
          if (suggestions.length === limit) break
        }
      }
      if (!found) break
    }
    return suggestions
  }

  artistDetail(user: AuthUser, id: number) {
    const row = this.database.prepare('SELECT * FROM artist WHERE id = ?').get(id) as Record<string, unknown> | undefined
    assertApp(row, 404, 'artist_not_found', '艺人不存在')
    const songRows = this.database.prepare('SELECT song_id FROM song_artist WHERE artist_id = ? ORDER BY sort_order').all(id) as Array<{ song_id: number }>
    const songs = this.visibleSummaries(user, songRows.map((item) => item.song_id))
    assertApp(songs.length > 0, 404, 'artist_not_found', '艺人不存在')
    return {
      id, nameJa: row.name_ja ?? undefined, nameZh: row.name_zh ?? undefined, nameEn: row.name_en ?? undefined,
      nameRomaji: row.name_romaji ?? undefined, displayName: firstText(row.name_zh, row.name_ja, row.name_en, row.name_romaji),
      artistType: row.artist_type ?? undefined, countryCode: row.country_code ?? undefined, avatarUrl: row.avatar_url ?? undefined,
      songs,
    }
  }

  workDetail(user: AuthUser, id: number) {
    const row = this.database.prepare('SELECT * FROM work WHERE id = ?').get(id) as Record<string, unknown> | undefined
    assertApp(row, 404, 'work_not_found', '作品不存在')
    const songRows = this.database.prepare('SELECT song_id FROM song_work WHERE work_id = ? ORDER BY sort_order').all(id) as Array<{ song_id: number }>
    const songs = this.visibleSummaries(user, songRows.map((item) => item.song_id))
    assertApp(songs.length > 0, 404, 'work_not_found', '作品不存在')
    return {
      id, titleJa: row.title_ja ?? undefined, titleZh: row.title_zh ?? undefined, titleEn: row.title_en ?? undefined,
      titleRomaji: row.title_romaji ?? undefined, displayTitle: firstText(row.title_zh, row.title_ja, row.title_en, row.title_romaji),
      workType: row.work_type ?? undefined, releaseDate: row.release_date ?? undefined, seasonLabel: row.season_label ?? undefined,
      coverUrl: row.cover_url ?? undefined, songs,
    }
  }

  albumDetail(user: AuthUser, id: number) {
    const row = this.database.prepare('SELECT * FROM album WHERE id = ?').get(id) as Record<string, unknown> | undefined
    assertApp(row, 404, 'album_not_found', '专辑不存在')
    const songRows = this.database.prepare('SELECT song_id, disc_no, track_no FROM album_song WHERE album_id = ? ORDER BY disc_no, track_no').all(id) as Array<{ song_id: number; disc_no: number; track_no: number }>
    const tracks = songRows.flatMap((item) => {
      try { return [{ song: this.songs.summary(user, item.song_id), discNo: item.disc_no, trackNo: item.track_no }] } catch { return [] }
    })
    assertApp(tracks.length > 0, 404, 'album_not_found', '专辑不存在')
    return {
      id, titleJa: row.title_ja ?? undefined, titleZh: row.title_zh ?? undefined, titleEn: row.title_en ?? undefined,
      titleRomaji: row.title_romaji ?? undefined, displayTitle: firstText(row.title_zh, row.title_ja, row.title_en, row.title_romaji),
      albumType: row.album_type ?? undefined, releaseDate: row.release_date ?? undefined, catalogNo: row.catalog_no ?? undefined,
      coverUrl: row.cover_url ?? undefined,
      tracks,
    }
  }

  private searchWithoutRecording(user: AuthUser, keyword: string, limit: number) {
    const pattern = `%${keyword.trim()}%`
    const ids = this.database.prepare(`
      SELECT DISTINCT s.id FROM song s LEFT JOIN song_alias sa ON sa.song_id = s.id
      WHERE s.title_ja LIKE ? OR s.title_zh LIKE ? OR s.title_en LIKE ? OR s.title_romaji LIKE ? OR sa.alias_text LIKE ? LIMIT ?
    `).all(pattern, pattern, pattern, pattern, pattern, limit) as Array<{ id: number }>
    return {
      songs: this.visibleSummaries(user, ids.map((row) => row.id)),
      artists: this.searchArtists(user, pattern, limit),
      works: this.searchWorks(user, pattern, limit),
      albums: this.searchAlbums(user, pattern, limit),
      ...this.acg.search(user, pattern, limit),
    }
  }

  private searchArtists(user: AuthUser, pattern: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT DISTINCT a.* FROM artist a LEFT JOIN artist_alias aa ON aa.artist_id = a.id
      WHERE (a.name_ja LIKE ? OR a.name_zh LIKE ? OR a.name_en LIKE ? OR a.name_romaji LIKE ? OR aa.alias_text LIKE ?)
        AND EXISTS (
          SELECT 1 FROM song_artist rel JOIN song s ON s.id = rel.song_id
          WHERE rel.artist_id = a.id AND ((s.review_status = 'approved' AND s.visibility = 'shared') OR s.submitted_by = ?)
        )
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, pattern, user.id, limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({ id: row.id, nameJa: row.name_ja ?? undefined, nameZh: row.name_zh ?? undefined, nameEn: row.name_en ?? undefined, nameRomaji: row.name_romaji ?? undefined, displayName: firstText(row.name_zh, row.name_ja, row.name_en, row.name_romaji), avatarUrl: row.avatar_url ?? undefined }))
  }

  private searchWorks(user: AuthUser, pattern: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT DISTINCT w.* FROM work w LEFT JOIN work_alias wa ON wa.work_id = w.id
      WHERE (w.title_ja LIKE ? OR w.title_zh LIKE ? OR w.title_en LIKE ? OR w.title_romaji LIKE ? OR wa.alias_text LIKE ?)
        AND EXISTS (
          SELECT 1 FROM song_work rel JOIN song s ON s.id = rel.song_id
          WHERE rel.work_id = w.id AND ((s.review_status = 'approved' AND s.visibility = 'shared') OR s.submitted_by = ?)
        )
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, pattern, user.id, limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({ id: row.id, titleJa: row.title_ja ?? undefined, titleZh: row.title_zh ?? undefined, titleEn: row.title_en ?? undefined, titleRomaji: row.title_romaji ?? undefined, displayTitle: firstText(row.title_zh, row.title_ja, row.title_en, row.title_romaji), coverUrl: row.cover_url ?? undefined }))
  }

  private searchAlbums(user: AuthUser, pattern: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT DISTINCT a.* FROM album a LEFT JOIN album_alias aa ON aa.album_id = a.id
      WHERE (a.title_ja LIKE ? OR a.title_zh LIKE ? OR a.title_en LIKE ? OR a.title_romaji LIKE ? OR aa.alias_text LIKE ?)
        AND EXISTS (
          SELECT 1 FROM album_song rel JOIN song s ON s.id = rel.song_id
          WHERE rel.album_id = a.id AND ((s.review_status = 'approved' AND s.visibility = 'shared') OR s.submitted_by = ?)
        )
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, pattern, user.id, limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({ id: row.id, titleJa: row.title_ja ?? undefined, titleZh: row.title_zh ?? undefined, titleEn: row.title_en ?? undefined, titleRomaji: row.title_romaji ?? undefined, displayTitle: firstText(row.title_zh, row.title_ja, row.title_en, row.title_romaji), coverUrl: row.cover_url ?? undefined }))
  }

  private visibleSummaries(user: AuthUser, ids: number[]) {
    return ids.flatMap((id) => { try { return [this.songs.summary(user, id)] } catch { return [] } })
  }
}
