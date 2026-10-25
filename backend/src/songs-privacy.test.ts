import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthService } from './auth.js'
import { buildApp } from './app.js'
import type { AppConfig } from './config.js'
import { openDatabase, runMigrations } from './db.js'

const temporaryDirectories: string[] = []

function createConfig(directory: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    databasePath: join(directory, 'test.sqlite'),
    mediaRoot: join(directory, 'media'),
    appOrigins: ['http://localhost:5173'],
    registrationMode: 'invite',
    friendShareReview: true,
    bootstrapAdminName: 'Owner',
    accessTokenTtlMinutes: 30,
    refreshTokenTtlDays: 30,
    maxAudioBytes: 1024,
    maxImageBytes: 1024,
    mediaSigningSecret: 'test-signing-secret',
    llmBaseUrl: 'http://127.0.0.1:11434/v1',
    llmModel: 'test',
    transcriptionModel: 'test-transcription',
    aiDailyLimit: 20,
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('private song visibility', () => {
  it('keeps an unshared friend import hidden from owners and exposes only share-review items', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'animeuta-song-privacy-'))
    temporaryDirectories.push(directory)
    const config = createConfig(directory)
    const database = openDatabase(config.databasePath)
    runMigrations(database)
    const auth = new AuthService(database, config)
    const app = await buildApp(config, database, auth)

    const owner = (await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'owner@example.com', password: 'correct-password' },
    })).json().data
    const invite = (await app.inject({
      method: 'POST',
      url: '/api/v1/admin/invites',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { maxUses: 1 },
    })).json().data
    const friend = (await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'friend@example.com', password: 'correct-password', inviteCode: invite.code },
    })).json().data

    database.prepare(`
      INSERT INTO song(id, title_ja, submitted_by, review_status, visibility)
      VALUES (1, 'Private song', ?, 'approved', 'private'), (2, 'Shared song', ?, 'approved', 'shared')
    `).run(friend.user.id, friend.user.id)
    database.prepare("INSERT INTO artist(id, name_ja) VALUES (1, 'Private artist'), (2, 'Shared artist')").run()
    database.prepare("INSERT INTO song_artist(song_id, artist_id) VALUES (1, 1), (2, 2)").run()
    database.prepare("INSERT INTO creator(id, name) VALUES (1, 'Private creator')").run()
    database.prepare("INSERT INTO song_creator(song_id, creator_id, role) VALUES (1, 1, 'composer')").run()
    database.prepare("INSERT INTO acg_character(id, name) VALUES (1, 'Private character')").run()
    database.prepare("INSERT INTO song_character(song_id, character_id) VALUES (1, 1)").run()
    database.prepare("INSERT INTO voice_actor(id, name) VALUES (1, 'Private voice actor')").run()
    database.prepare("INSERT INTO character_voice_actor(character_id, voice_actor_id) VALUES (1, 1)").run()
    database.prepare("INSERT INTO publisher(id, name) VALUES (1, 'Private publisher')").run()
    database.prepare("INSERT INTO label(id, publisher_id, name) VALUES (1, 1, 'Private label')").run()
    database.prepare('UPDATE song SET publisher_id = 1, label_id = 1 WHERE id = 1').run()
    database.prepare("INSERT INTO song_version_group(id, group_title, canonical_song_id) VALUES (1, 'Versions', 1)").run()
    database.prepare("UPDATE song SET version_group_id = 1 WHERE id IN (1, 2)").run()
    database.prepare("INSERT INTO playlist(id, user_id, name, visibility) VALUES (1, ?, 'Friend private list', 'private')").run(friend.user.id)

    const ownerHeaders = { authorization: `Bearer ${owner.token}` }
    const friendHeaders = { authorization: `Bearer ${friend.token}` }
    const ownerList = await app.inject({ method: 'GET', url: '/api/v1/songs', headers: ownerHeaders })
    expect(ownerList.statusCode).toBe(200)
    expect(ownerList.json().data.map((song: { id: number }) => song.id)).toEqual([2])
    expect((await app.inject({ method: 'GET', url: '/api/v1/songs/1', headers: ownerHeaders })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/v1/songs/1', headers: friendHeaders })).statusCode).toBe(200)
    const sharedDetail = await app.inject({ method: 'GET', url: '/api/v1/songs/2', headers: ownerHeaders })
    expect(sharedDetail.json().data.versionGroup.versions.map((song: { id: number }) => song.id)).toEqual([2])
    expect((await app.inject({ method: 'GET', url: '/api/v1/search?keyword=Private', headers: ownerHeaders })).json().data.artists).toEqual([])
    const privateAcgSearch = (await app.inject({ method: 'GET', url: '/api/v1/search?keyword=Private', headers: ownerHeaders })).json().data
    const ownerPagedSearch = (await app.inject({ method: 'GET', url: '/api/v1/search?keyword=Song&page=1&page_size=1', headers: ownerHeaders })).json().data
    expect(ownerPagedSearch.songs.map((song: { id: number }) => song.id)).toEqual([2])
    expect(ownerPagedSearch.pagination).toEqual({ page: 1, page_size: 1, total: 1 })
    const friendSearchPageOne = (await app.inject({ method: 'GET', url: '/api/v1/search?keyword=Song&page=1&page_size=1', headers: friendHeaders })).json().data
    const friendSearchPageTwo = (await app.inject({ method: 'GET', url: '/api/v1/search?keyword=Song&page=2&page_size=1', headers: friendHeaders })).json().data
    expect(friendSearchPageOne.pagination).toEqual({ page: 1, page_size: 1, total: 2 })
    expect(friendSearchPageTwo.pagination).toEqual({ page: 2, page_size: 1, total: 2 })
    expect(new Set([...friendSearchPageOne.songs, ...friendSearchPageTwo.songs].map((song: { id: number }) => song.id))).toEqual(new Set([1, 2]))
    expect(privateAcgSearch.creators).toEqual([])
    expect(privateAcgSearch.characters).toEqual([])
    expect(privateAcgSearch.voiceActors).toEqual([])
    expect(privateAcgSearch.publishers).toEqual([])
    expect(privateAcgSearch.labels).toEqual([])
    expect((await app.inject({ method: 'GET', url: '/api/v1/acg/creator/1', headers: ownerHeaders })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/v1/acg/creator/1', headers: friendHeaders })).statusCode).toBe(200)
    await app.inject({ method: 'GET', url: '/api/v1/search?keyword=friend-secret-query', headers: friendHeaders })
    expect((await app.inject({ method: 'GET', url: '/api/v1/search/hot?limit=50', headers: friendHeaders })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/v1/artists/1', headers: ownerHeaders })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/v1/artists/1', headers: friendHeaders })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/playlists/1', headers: ownerHeaders })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/playlists/1', headers: ownerHeaders, payload: { name: 'Taken over' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/admin/songs/1/review', headers: ownerHeaders, payload: { status: 'approved' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/admin/songs/1', headers: ownerHeaders })).statusCode).toBe(404)

    const metadata = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/songs/2/metadata',
      headers: ownerHeaders,
      payload: {
        songCoverUrl: '/api/v1/media/images/song-cover.jpg?expires=123&signature=temporary',
        artistName: 'Shared artist',
        artistAvatarUrl: '/api/v1/media/images/artist.jpg?expires=123&signature=temporary',
        workTitle: 'Shared work',
        workCoverUrl: '/api/v1/media/images/work.jpg?expires=123&signature=temporary',
        albumTitle: 'Shared album',
        albumCoverUrl: '/api/v1/media/images/album.jpg?expires=123&signature=temporary',
        publisherName: 'Shared publisher',
        labelName: 'Shared label',
        versionGroupTitle: 'Versions',
        versionType: 'live',
        songAliases: ['shared-song-alias'],
        artistAliases: ['shared-artist-alias'],
        workAliases: ['shared-work-alias'],
        albumAliases: ['shared-album-alias'],
        creators: [{ name: 'Shared creator', role: 'composer', creatorType: 'person' }],
        characters: [{ name: 'Shared character', relationType: 'character_song', voiceActorNames: ['Shared voice actor'] }],
      },
    })
    expect(metadata.statusCode).toBe(200)
    expect(metadata.json().data).toMatchObject({
      versionType: 'live',
      aliases: ['shared-song-alias'],
      artists: [{ aliases: ['shared-artist-alias'] }],
      works: [{ aliases: ['shared-work-alias'] }],
      albums: [{ aliases: ['shared-album-alias'] }],
      publisher: { name: 'Shared publisher' },
      label: { name: 'Shared label' },
      creators: [{ name: 'Shared creator', role: 'composer' }],
      characters: [{ name: 'Shared character', voiceActors: [{ name: 'Shared voice actor' }] }],
    })
    expect(database.prepare('SELECT cover_url FROM song WHERE id = 2').get()).toEqual({ cover_url: '/media/images/song-cover.jpg' })
    expect(database.prepare("SELECT avatar_url FROM artist WHERE name_ja = 'Shared artist'").get()).toEqual({ avatar_url: '/media/images/artist.jpg' })
    expect(database.prepare("SELECT cover_url FROM work WHERE title_ja = 'Shared work'").get()).toEqual({ cover_url: '/media/images/work.jpg' })
    expect(database.prepare("SELECT cover_url FROM album WHERE title_ja = 'Shared album'").get()).toEqual({ cover_url: '/media/images/album.jpg' })

    const clearedImages = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/songs/2/metadata',
      headers: ownerHeaders,
      payload: {
        songCoverUrl: '', artistName: 'Shared artist', artistAvatarUrl: '',
        workTitle: 'Shared work', workCoverUrl: '', albumTitle: 'Shared album', albumCoverUrl: '',
        songAliases: ['shared-song-alias'], artistAliases: ['shared-artist-alias'],
        workAliases: ['shared-work-alias'], albumAliases: ['shared-album-alias'],
        creators: [{ name: 'Shared creator', role: 'composer', creatorType: 'person' }],
        characters: [{ name: 'Shared character', relationType: 'character_song', voiceActorNames: ['Shared voice actor'] }],
      },
    })
    expect(clearedImages.statusCode).toBe(200)
    expect(database.prepare('SELECT cover_url FROM song WHERE id = 2').get()).toEqual({ cover_url: null })
    expect(database.prepare("SELECT avatar_url FROM artist WHERE name_ja = 'Shared artist'").get()).toEqual({ avatar_url: null })
    expect(database.prepare("SELECT cover_url FROM work WHERE title_ja = 'Shared work'").get()).toEqual({ cover_url: null })
    expect(database.prepare("SELECT cover_url FROM album WHERE title_ja = 'Shared album'").get()).toEqual({ cover_url: null })
    const acgEntities = [
      ['creator', metadata.json().data.creators[0].id, 'creator-search-alias'],
      ['character', metadata.json().data.characters[0].id, 'character-search-alias'],
      ['voice_actor', metadata.json().data.characters[0].voiceActors[0].id, 'voice-search-alias'],
      ['publisher', metadata.json().data.publisher.id, 'publisher-search-alias'],
      ['label', metadata.json().data.label.id, 'label-search-alias'],
      ['version_group', metadata.json().data.versionGroup.id, 'versions-search-alias'],
    ] as const
    for (const [kind, entityId, alias] of acgEntities) {
      const update = await app.inject({
        method: 'PATCH', url: `/api/v1/admin/acg/${kind}/${entityId}`, headers: ownerHeaders,
        payload: { aliases: [alias], imageUrl: `/media/images/${kind}.jpg` },
      })
      expect(update.statusCode).toBe(200)
      expect(update.json().data).toMatchObject({ kind, id: entityId, aliases: [alias] })
      if (kind === 'creator') expect(update.json().data.secondaryText).toBeUndefined()
      expect(update.json().data.relatedSongs.map((item: { song: { id: number } }) => item.song.id)).toEqual([2])
      const found = (await app.inject({ method: 'GET', url: `/api/v1/search?keyword=${alias}`, headers: ownerHeaders })).json().data
      const resultKey = kind === 'voice_actor' ? 'voiceActors' : kind === 'version_group' ? 'versionGroups' : `${kind}s`
      expect(found[resultKey].map((item: { id: number }) => item.id)).toContain(entityId)
      expect((await app.inject({ method: 'GET', url: `/api/v1/acg/${kind}/${entityId}`, headers: ownerHeaders })).statusCode).toBe(200)
    }
    expect((await app.inject({
      method: 'PATCH', url: `/api/v1/admin/acg/creator/${metadata.json().data.creators[0].id}`, headers: friendHeaders,
      payload: { aliases: ['not-allowed'] },
    })).statusCode).toBe(403)
    const aliasSearches = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/search?keyword=shared-song-alias', headers: ownerHeaders }),
      app.inject({ method: 'GET', url: '/api/v1/search?keyword=shared-artist-alias', headers: ownerHeaders }),
      app.inject({ method: 'GET', url: '/api/v1/search?keyword=shared-work-alias', headers: ownerHeaders }),
      app.inject({ method: 'GET', url: '/api/v1/search?keyword=shared-album-alias', headers: ownerHeaders }),
    ])
    expect(aliasSearches[0].json().data.songs.map((song: { id: number }) => song.id)).toEqual([2])
    expect(aliasSearches[1].json().data.artists.map((artist: { id: number }) => artist.id)).toEqual([2])
    expect(aliasSearches[2].json().data.works.map((work: { displayTitle: string }) => work.displayTitle)).toEqual(['Shared work'])
    expect(aliasSearches[3].json().data.albums.map((album: { displayTitle: string }) => album.displayTitle)).toEqual(['Shared album'])

    database.prepare(`
      INSERT INTO lyric(id, song_id, original_text, uploaded_by, review_status, visibility)
      VALUES (1, 1, 'hidden draft', ?, 'pending', 'private'), (2, 2, 'shared draft', ?, 'pending', 'private')
    `).run(friend.user.id, friend.user.id)
    database.prepare(`
      INSERT INTO lyric_line(id, lyric_id, line_index, original_text)
      VALUES (1, 1, 0, 'hidden line'), (2, 2, 0, 'shared line')
    `).run()
    database.prepare("INSERT INTO lexeme(id, language_code, lemma, writing) VALUES (1, 'ja', '秘密', '秘密'), (2, 'ja', '未投稿', '未投稿')").run()
    database.prepare("INSERT INTO lyric_token(line_id, lexeme_id, token_index, surface) VALUES (1, 1, 0, '秘密'), (2, 2, 0, '未投稿')").run()
    expect((await app.inject({
      method: 'PATCH', url: '/api/v1/study/lexemes/1', headers: ownerHeaders,
      payload: { meaningZh: '不应读取' },
    })).statusCode).toBe(404)
    const ownerCorrection = await app.inject({
      method: 'PATCH', url: '/api/v1/study/lexemes/1', headers: friendHeaders,
      payload: { meaningZh: '秘密' },
    })
    expect(ownerCorrection.statusCode).toBe(200)
    expect(ownerCorrection.json().data.meaningZh).toBe('秘密')
    expect((await app.inject({
      method: 'PATCH', url: '/api/v1/study/lexemes/2', headers: ownerHeaders,
      payload: { meaningZh: '不应读取未投稿歌词' },
    })).statusCode).toBe(404)
    const secondInvite = (await app.inject({
      method: 'POST', url: '/api/v1/admin/invites', headers: ownerHeaders, payload: { maxUses: 1 },
    })).json().data
    const secondFriend = (await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'friend2@example.com', password: 'correct-password', inviteCode: secondInvite.code },
    })).json().data
    const secondFriendHeaders = { authorization: `Bearer ${secondFriend.token}` }
    expect((await app.inject({ method: 'GET', url: '/api/v1/songs/2', headers: secondFriendHeaders })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/lyrics/2/annotations', headers: secondFriendHeaders })).statusCode).toBe(404)
    expect((await app.inject({
      method: 'POST', url: '/api/v1/lyrics/2/annotations', headers: secondFriendHeaders,
      payload: { body: 'Must not reach a private lyric', category: 'note', lineId: 2, visibility: 'private' },
    })).statusCode).toBe(404)
    const lyricQueue = await app.inject({ method: 'GET', url: '/api/v1/admin/lyric-submissions?status=pending', headers: ownerHeaders })
    expect(lyricQueue.statusCode).toBe(200)
    expect(lyricQueue.json().data).toEqual([])
    expect((await app.inject({ method: 'GET', url: '/api/v1/songs/2/lyrics/versions', headers: ownerHeaders })).json().data).toEqual([])
    const lyricRequest = await app.inject({ method: 'POST', url: '/api/v1/lyrics/2/share-request', headers: friendHeaders })
    expect(lyricRequest.statusCode).toBe(200)
    expect(lyricRequest.json().data).toMatchObject({ id: 2, reviewStatus: 'pending', visibility: 'private' })
    expect(lyricRequest.json().data.reviewRequestedAt).toBeTruthy()
    expect((await app.inject({
      method: 'PATCH', url: '/api/v1/study/lexemes/2', headers: ownerHeaders,
      payload: { meaningZh: '已提交审核' },
    })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/lyric-submissions?status=pending', headers: ownerHeaders })).json().data.map((lyric: { id: number }) => lyric.id)).toEqual([2])
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/lyrics/2/review', headers: ownerHeaders, payload: { status: 'approved' } })).statusCode).toBe(200)

    const sharedAnnotation = await app.inject({
      method: 'POST', url: '/api/v1/lyrics/2/annotations', headers: friendHeaders,
      payload: { body: 'Useful grammar note', category: 'grammar', lineId: 2, visibility: 'public' },
    })
    expect(sharedAnnotation.json().data).toMatchObject({ reviewStatus: 'pending', visibility: 'private' })
    const privateAnnotation = await app.inject({
      method: 'POST', url: '/api/v1/lyrics/2/annotations', headers: friendHeaders,
      payload: { body: 'My private note', category: 'note', lineId: 2, visibility: 'private' },
    })
    expect(privateAnnotation.json().data).toMatchObject({ reviewStatus: 'approved', visibility: 'private' })
    database.prepare(`
      INSERT INTO lyric_annotation(lyric_id, line_id, category, body, visibility, annotation_scope, created_by, review_status)
      VALUES (2, 2, 'note', 'AI private draft', 'private', 'learning', ?, 'pending')
    `).run(friend.user.id)
    const annotationQueue = await app.inject({ method: 'GET', url: '/api/v1/admin/annotation-submissions?status=pending', headers: ownerHeaders })
    expect(annotationQueue.json().data.map((annotation: { body: string }) => annotation.body)).toEqual(['Useful grammar note'])
    expect((await app.inject({ method: 'GET', url: '/api/v1/lyrics/2/annotations', headers: ownerHeaders })).json().data).toEqual([])
    expect((await app.inject({ method: 'GET', url: '/api/v1/lyrics/2/annotations', headers: friendHeaders })).json().data).toHaveLength(3)
    const approvedAnnotation = await app.inject({
      method: 'PATCH', url: `/api/v1/annotations/${sharedAnnotation.json().data.id}/review`, headers: ownerHeaders,
      payload: { status: 'approved', reviewNote: 'Checked' },
    })
    expect(approvedAnnotation.json().data).toMatchObject({ reviewStatus: 'approved', visibility: 'public', reviewNote: 'Checked' })
    expect((await app.inject({ method: 'GET', url: '/api/v1/lyrics/2/annotations', headers: ownerHeaders })).json().data.map((annotation: { body: string }) => annotation.body)).toEqual(['Useful grammar note'])
    expect((await app.inject({
      method: 'PATCH', url: `/api/v1/annotations/${privateAnnotation.json().data.id}/review`, headers: ownerHeaders,
      payload: { status: 'approved' },
    })).statusCode).toBe(404)
    const annotationRequest = await app.inject({
      method: 'POST', url: `/api/v1/annotations/${privateAnnotation.json().data.id}/share-request`, headers: friendHeaders,
    })
    expect(annotationRequest.json().data.reviewRequestedAt).toBeTruthy()
    expect((await app.inject({
      method: 'PATCH', url: `/api/v1/annotations/${privateAnnotation.json().data.id}/review`, headers: ownerHeaders,
      payload: { status: 'needs_revision', reviewNote: 'Add an example' },
    })).json().data).toMatchObject({ reviewStatus: 'needs_revision', visibility: 'private' })
    expect((await app.inject({
      method: 'POST', url: `/api/v1/annotations/${privateAnnotation.json().data.id}/share-request`, headers: friendHeaders,
    })).json().data).toMatchObject({ reviewStatus: 'pending', visibility: 'private' })
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/annotation-submissions?status=pending', headers: ownerHeaders })).json().data.map((annotation: { body: string }) => annotation.body)).toEqual(['My private note'])
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/lyrics/1/review', headers: ownerHeaders, payload: { status: 'approved' } })).statusCode).toBe(404)

    const approvedQueue = await app.inject({ method: 'GET', url: '/api/v1/admin/song-submissions?status=approved', headers: ownerHeaders })
    expect(approvedQueue.json().data.map((song: { id: number }): number => song.id)).toEqual([2])

    database.prepare("UPDATE song SET review_status = 'pending', cover_url = '/media/images/pending.jpg' WHERE id = 1").run()
    const pendingQueue = await app.inject({ method: 'GET', url: '/api/v1/admin/song-submissions?status=pending', headers: ownerHeaders })
    expect(pendingQueue.json().data.map((song: { id: number }): number => song.id)).toEqual([1])
    expect(pendingQueue.json().data[0]).toMatchObject({
      submittedByName: 'friend',
      submittedByEmail: 'friend@example.com',
    })
    expect(pendingQueue.json().data[0].coverUrl).toMatch(/^\/api\/v1\/media\/images\/pending\.jpg\?expires=/)
    expect((await app.inject({ method: 'GET', url: '/api/v1/songs/1', headers: ownerHeaders })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/v1/songs', headers: ownerHeaders })).json().data.map((song: { id: number }): number => song.id)).toEqual([2])
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/song-submissions', headers: friendHeaders })).statusCode).toBe(403)

    await app.close()
    database.close()
  })
})
