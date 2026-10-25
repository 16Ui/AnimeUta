import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from './auth.js'
import { openDatabase, runMigrations, type SqliteDatabase } from './db.js'
import { LibraryService } from './library.js'
import type { SongService } from './songs.js'

const directories: string[] = []

function setup(): { database: SqliteDatabase; library: LibraryService; user: AuthUser } {
  const directory = mkdtempSync(join(tmpdir(), 'animeuta-library-'))
  directories.push(directory)
  const database = openDatabase(join(directory, 'test.sqlite'))
  runMigrations(database)
  database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (1, 'owner@example.com', 'hash', 'salt', 'Owner', 'owner')`).run()
  database.prepare(`
    INSERT INTO song(id, title_ja, submitted_by, review_status, visibility)
    VALUES (1, 'One', 1, 'approved', 'shared'), (2, 'Two', 1, 'approved', 'shared'), (3, 'Three', 1, 'approved', 'shared')
  `).run()
  const songs = {
    assertVisible: vi.fn(),
    summary: vi.fn((_user: AuthUser, id: number) => ({ id, displayTitle: String(id) })),
  } as unknown as SongService
  return {
    database,
    library: new LibraryService(database, songs),
    user: { id: 1, email: 'owner@example.com', role: 'owner', displayName: 'Owner', preferredLanguage: 'zh-CN' },
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('personal library integrity', () => {
  it('shares public playlists while protecting private lists and owner operations', () => {
    const { database, library, user } = setup()
    try {
      database.prepare(`INSERT INTO app_user(id, email, password_hash, password_salt, display_name, role) VALUES (2, 'friend@example.com', 'hash', 'salt', 'Friend', 'user')`).run()
      const friend: AuthUser = { id: 2, email: 'friend@example.com', role: 'user', displayName: 'Friend', preferredLanguage: 'zh-CN' }
      const playlist = library.createPlaylist(user, { name: 'Private study', visibility: 'public' })
      expect(playlist.visibility).toBe('public')
      expect(library.listPlaylists(friend).map(p=>p.id)).toContain(playlist.id)
      expect(library.addPlaylistSongs(friend,playlist.id,[1,2,1])).toEqual({added:2,existing:0})
      expect(library.addPlaylistSongs(friend,playlist.id,[2,3])).toEqual({added:1,existing:1})
      expect(library.playlistDetail(friend,playlist.id).songs.map(s=>s.song.id)).toEqual([1,2,3])
      expect(()=>library.deletePlaylist(friend,playlist.id)).toThrow()
      expect(()=>library.reorderPlaylist(friend,playlist.id,[3,2,1])).toThrow()
      expect(()=>library.removePlaylistSong(friend,playlist.id,1)).toThrow()
      library.updatePlaylist(user,playlist.id,{visibility:'private'})
      expect(()=>library.playlistDetail(friend,playlist.id)).toThrow()
      expect(()=>library.addPlaylistSongs(friend,playlist.id,[1])).toThrow()
      database.prepare("UPDATE song SET visibility='private' WHERE id=1").run()
      expect(()=>library.updatePlaylist(user,playlist.id,{visibility:'public'})).toThrow()
    } finally {
      database.close()
    }
  })

  it('inserts and moves songs without replacing another song at the target position', () => {
    const { database, library, user } = setup()
    try {
      const playlist = library.createPlaylist(user, { name: 'Study' })
      library.addPlaylistSong(user, playlist.id, 1)
      library.addPlaylistSong(user, playlist.id, 2)
      library.addPlaylistSong(user, playlist.id, 3, 1)
      expect(library.playlistDetail(user, playlist.id).songs.map((item) => item.song.id)).toEqual([3, 1, 2])

      library.addPlaylistSong(user, playlist.id, 2, 1)
      expect(library.playlistDetail(user, playlist.id).songs.map((item) => item.song.id)).toEqual([2, 3, 1])
    } finally {
      database.close()
    }
  })

  it('uses the first available song artwork as the playlist thumbnail', () => {
    const { database, library, user } = setup()
    try {
      database.prepare("UPDATE song SET cover_url = '/media/covers/one.jpg' WHERE id = 1").run()
      const playlist = library.createPlaylist(user, { name: 'Artwork' })
      library.addPlaylistSong(user, playlist.id, 1)

      expect(library.listPlaylists(user)[0]).toMatchObject({ coverUrl: '/media/covers/one.jpg' })
      expect(library.playlistDetail(user, playlist.id)).toMatchObject({ coverUrl: '/media/covers/one.jpg' })
    } finally {
      database.close()
    }
  })

  it('rejects invalid playback telemetry instead of storing corrupt values', () => {
    const { database, library, user } = setup()
    try {
      expect(() => library.addHistory(user, { songId: 1, duration: -1 })).toThrowError(expect.objectContaining({ code: 'invalid_play_duration' }))
      expect(() => library.addHistory(user, { songId: 1, completionRate: 1.2 })).toThrowError(expect.objectContaining({ code: 'invalid_completion_rate' }))
      expect(() => library.addHistory(user, { songId: 1, lastPosition: -1 })).toThrowError(expect.objectContaining({ code: 'invalid_play_position' }))
      expect(database.prepare('SELECT count(*) AS count FROM play_history').get()).toMatchObject({ count: 0 })
    } finally {
      database.close()
    }
  })

  it('keeps one history row per song and updates its latest playback state', () => {
    const { database, library, user } = setup()
    try {
      const playlist = library.createPlaylist(user, { name: 'Night study' })
      library.addPlaylistSong(user, playlist.id, 1)
      library.addHistory(user, {
        songId: 1,
        playedAt: '2026-09-15T12:00:00.000Z',
        lastPosition: 12,
        playlistId: playlist.id,
      })
      library.addHistory(user, {
        songId: 1,
        playedAt: '2026-09-16T12:00:00.000Z',
        lastPosition: 48.5,
        playlistId: playlist.id,
        completionRate: 0.5,
      })

      expect(database.prepare('SELECT count(*) AS count FROM play_history WHERE user_id = 1 AND song_id = 1').get()).toMatchObject({ count: 1 })
      expect(library.listHistory(user, 1, 10).data[0]).toMatchObject({
        playedAt: '2026-09-16T12:00:00.000Z',
        lastPositionSeconds: 48.5,
        completionRate: 0.5,
        playlist: { id: playlist.id, name: 'Night study' },
      })

      library.addHistory(user, { songId: 1, playedAt: '2026-09-16T13:00:00.000Z', lastPosition: 3, playlistId: null })
      expect(library.listHistory(user, 1, 10).data[0]).toMatchObject({
        playedAt: '2026-09-16T13:00:00.000Z',
        lastPositionSeconds: 3,
        playlist: undefined,
      })
    } finally {
      database.close()
    }
  })
})
