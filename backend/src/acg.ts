import type { AuthUser } from './auth.js'
import type { SqliteDatabase } from './db.js'
import { nowIso } from './db.js'
import { assertApp } from './errors.js'
import { normalizeImageUri } from './media.js'
import type { SongService } from './songs.js'

export type AcgEntityKind = 'creator' | 'character' | 'voice_actor' | 'publisher' | 'label' | 'version_group'

export interface AcgEntityUpdateInput {
  name?: string
  nameJa?: string
  nameZh?: string
  nameEn?: string
  nameRomaji?: string
  imageUrl?: string
  description?: string
  websiteUrl?: string
  aliases: string[]
}

interface EntityProfile {
  table: string
  aliasTable: string
  aliasForeignKey: string
  primaryColumn: string
  nameJaColumn?: string
  nameZhColumn?: string
  nameEnColumn?: string
  nameRomajiColumn?: string
  imageColumn?: string
  descriptionColumn?: string
  websiteColumn?: string
  notFoundCode: string
  notFoundMessage: string
}

interface AcgEntitySummary {
  id: number
  displayName: string
  imageUrl?: string
  secondaryText?: string
}

interface AcgConnection {
  kind: AcgEntityKind | 'work'
  id: number
  displayName: string
}

interface AcgEntityDetail extends AcgEntitySummary {
  kind: AcgEntityKind
  name: string
  nameJa?: string
  nameZh?: string
  nameEn?: string
  nameRomaji?: string
  description?: string
  websiteUrl?: string
  aliases: string[]
  connections: AcgConnection[]
  relatedSongs: Array<{ song: ReturnType<SongService['summary']>; relation?: string }>
}

function firstText(...values: unknown[]): string {
  return values.find((value) => typeof value === 'string' && value.trim()) as string || ''
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export class AcgService {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly songs: SongService,
  ) {}

  search(user: AuthUser, pattern: string, limit: number) {
    limit = Math.min(50, Math.max(1, limit))
    return {
      creators: this.searchCreators(user, pattern, limit),
      characters: this.searchCharacters(user, pattern, limit),
      voiceActors: this.searchVoiceActors(user, pattern, limit),
      publishers: this.searchPublishers(user, pattern, limit),
      labels: this.searchLabels(user, pattern, limit),
      versionGroups: this.searchVersionGroups(user, pattern, limit),
    }
  }

  detail(user: AuthUser, kind: AcgEntityKind, id: number): AcgEntityDetail {
    const profile = this.entityProfile(kind)
    const row = this.database.prepare(`SELECT * FROM ${profile.table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    assertApp(row, 404, profile.notFoundCode, profile.notFoundMessage)
    const relatedSongs = this.relatedSongs(user, kind, id)
    assertApp(relatedSongs.length > 0, 404, profile.notFoundCode, profile.notFoundMessage)
    const nameJa = optionalText(row.name_ja)
    const nameZh = optionalText(row.name_zh)
    const nameEn = optionalText(row.name_en)
    const nameRomaji = optionalText(row.name_romaji)
    const description = optionalText(row.description)
    const websiteUrl = optionalText(row.website_url)
    return {
      kind,
      ...this.namedSummary(kind, row),
      name: firstText(kind === 'version_group' ? row.group_title : row.name),
      ...(nameJa ? { nameJa } : {}),
      ...(nameZh ? { nameZh } : {}),
      ...(nameEn ? { nameEn } : {}),
      ...(nameRomaji ? { nameRomaji } : {}),
      ...(description ? { description } : {}),
      ...(websiteUrl ? { websiteUrl } : {}),
      aliases: this.aliases(profile.aliasTable, profile.aliasForeignKey, id),
      connections: this.connections(user, kind, row),
      relatedSongs,
    }
  }

  update(user: AuthUser, kind: AcgEntityKind, id: number, input: AcgEntityUpdateInput) {
    this.detail(user, kind, id)
    const profile = this.entityProfile(kind)
    const primaryName = input.name?.trim()
    if (input.name !== undefined) assertApp(primaryName, 400, 'entity_name_required', '名称不能为空')
    const assignments: string[] = []
    const values: Array<string | null> = []
    const setValue = (column: string | undefined, value: string | undefined) => {
      if (!column || value === undefined) return
      assignments.push(`${column} = ?`)
      values.push(value.trim() || null)
    }
    setValue(profile.primaryColumn, input.name)
    setValue(profile.nameJaColumn, input.nameJa)
    setValue(profile.nameZhColumn, input.nameZh)
    setValue(profile.nameEnColumn, input.nameEn)
    setValue(profile.nameRomajiColumn, input.nameRomaji)
    setValue(profile.imageColumn, input.imageUrl === undefined ? undefined : normalizeImageUri(input.imageUrl))
    setValue(profile.descriptionColumn, input.description)
    setValue(profile.websiteColumn, input.websiteUrl)

    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (assignments.length > 0) {
        assignments.push('updated_at = ?')
        values.push(nowIso())
        this.database.prepare(`UPDATE ${profile.table} SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id)
      }
      this.replaceAliases(profile.aliasTable, profile.aliasForeignKey, id, input.aliases)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.detail(user, kind, id)
  }

  private searchCreators(user: AuthUser, pattern: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT DISTINCT c.* FROM creator c LEFT JOIN creator_alias ca ON ca.creator_id = c.id
      WHERE (c.name LIKE ? OR c.name_ja LIKE ? OR c.name_zh LIKE ? OR c.name_en LIKE ? OR c.name_romaji LIKE ? OR ca.alias_text LIKE ?)
        AND EXISTS (
          SELECT 1 FROM song_creator rel JOIN song s ON s.id = rel.song_id
          WHERE rel.creator_id = c.id AND ${this.visibleSongSql()}
        )
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, pattern, pattern, user.id, limit) as Array<Record<string, unknown>>
    return rows.map((row) => this.namedSummary('creator', row))
  }

  private searchCharacters(user: AuthUser, pattern: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT DISTINCT c.* FROM acg_character c LEFT JOIN character_alias ca ON ca.character_id = c.id
      WHERE (c.name LIKE ? OR c.name_ja LIKE ? OR c.name_zh LIKE ? OR c.name_en LIKE ? OR c.name_romaji LIKE ? OR ca.alias_text LIKE ?)
        AND EXISTS (
          SELECT 1 FROM song_character rel JOIN song s ON s.id = rel.song_id
          WHERE rel.character_id = c.id AND ${this.visibleSongSql()}
        )
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, pattern, pattern, user.id, limit) as Array<Record<string, unknown>>
    return rows.map((row) => this.namedSummary('character', row))
  }

  private searchVoiceActors(user: AuthUser, pattern: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT DISTINCT va.* FROM voice_actor va LEFT JOIN voice_actor_alias vaa ON vaa.voice_actor_id = va.id
      WHERE (va.name LIKE ? OR va.name_ja LIKE ? OR va.name_zh LIKE ? OR va.name_en LIKE ? OR va.name_romaji LIKE ? OR vaa.alias_text LIKE ?)
        AND EXISTS (
          SELECT 1 FROM character_voice_actor cva
          JOIN song_character rel ON rel.character_id = cva.character_id
          JOIN song s ON s.id = rel.song_id
          WHERE cva.voice_actor_id = va.id AND ${this.visibleSongSql()}
        )
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, pattern, pattern, user.id, limit) as Array<Record<string, unknown>>
    return rows.map((row) => this.namedSummary('voice_actor', row))
  }

  private searchPublishers(user: AuthUser, pattern: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT DISTINCT p.* FROM publisher p LEFT JOIN publisher_alias pa ON pa.publisher_id = p.id
      WHERE (p.name LIKE ? OR p.name_ja LIKE ? OR p.name_zh LIKE ? OR p.name_en LIKE ? OR p.name_romaji LIKE ? OR pa.alias_text LIKE ?)
        AND EXISTS (SELECT 1 FROM song s WHERE s.publisher_id = p.id AND ${this.visibleSongSql()})
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, pattern, pattern, user.id, limit) as Array<Record<string, unknown>>
    return rows.map((row) => this.namedSummary('publisher', row))
  }

  private searchLabels(user: AuthUser, pattern: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT DISTINCT l.* FROM label l LEFT JOIN label_alias la ON la.label_id = l.id
      WHERE (l.name LIKE ? OR l.name_ja LIKE ? OR l.name_zh LIKE ? OR l.name_en LIKE ? OR l.name_romaji LIKE ? OR la.alias_text LIKE ?)
        AND EXISTS (SELECT 1 FROM song s WHERE s.label_id = l.id AND ${this.visibleSongSql()})
      LIMIT ?
    `).all(pattern, pattern, pattern, pattern, pattern, pattern, user.id, limit) as Array<Record<string, unknown>>
    return rows.map((row) => this.namedSummary('label', row))
  }

  private searchVersionGroups(user: AuthUser, pattern: string, limit: number) {
    const rows = this.database.prepare(`
      SELECT DISTINCT vg.* FROM song_version_group vg
      LEFT JOIN version_group_alias vga ON vga.version_group_id = vg.id
      WHERE (vg.group_title LIKE ? OR vga.alias_text LIKE ?)
        AND EXISTS (SELECT 1 FROM song s WHERE s.version_group_id = vg.id AND ${this.visibleSongSql()})
      LIMIT ?
    `).all(pattern, pattern, user.id, limit) as Array<Record<string, unknown>>
    return rows.map((row) => this.namedSummary('version_group', row))
  }

  private relatedSongs(user: AuthUser, kind: AcgEntityKind, id: number) {
    let rows: Array<{ song_id: number; relation: string | null }>
    if (kind === 'creator') {
      rows = this.database.prepare('SELECT song_id, role AS relation FROM song_creator WHERE creator_id = ? ORDER BY sort_order').all(id) as typeof rows
    } else if (kind === 'character') {
      rows = this.database.prepare('SELECT song_id, relation_type AS relation FROM song_character WHERE character_id = ? ORDER BY sort_order').all(id) as typeof rows
    } else if (kind === 'voice_actor') {
      rows = this.database.prepare(`
        SELECT DISTINCT sc.song_id, sc.relation_type AS relation
        FROM character_voice_actor cva JOIN song_character sc ON sc.character_id = cva.character_id
        WHERE cva.voice_actor_id = ? ORDER BY sc.sort_order
      `).all(id) as typeof rows
    } else if (kind === 'publisher') {
      rows = this.database.prepare('SELECT id AS song_id, NULL AS relation FROM song WHERE publisher_id = ? ORDER BY created_at DESC').all(id) as typeof rows
    } else if (kind === 'label') {
      rows = this.database.prepare('SELECT id AS song_id, NULL AS relation FROM song WHERE label_id = ? ORDER BY created_at DESC').all(id) as typeof rows
    } else {
      rows = this.database.prepare('SELECT id AS song_id, version_type AS relation FROM song WHERE version_group_id = ? ORDER BY created_at').all(id) as typeof rows
    }
    const seen = new Set<number>()
    return rows.flatMap((row) => {
      if (seen.has(row.song_id)) return []
      try {
        const song = this.songs.summary(user, row.song_id)
        seen.add(row.song_id)
        return [{ song, ...(row.relation ? { relation: row.relation } : {}) }]
      } catch {
        return []
      }
    })
  }

  private connections(user: AuthUser, kind: AcgEntityKind, row: Record<string, unknown>): AcgConnection[] {
    if (kind === 'character') {
      const work = row.work_id ? this.visibleConnection(user, 'work', Number(row.work_id)) : undefined
      const actors = this.database.prepare(`
        SELECT va.* FROM character_voice_actor cva JOIN voice_actor va ON va.id = cva.voice_actor_id
        WHERE cva.character_id = ? ORDER BY cva.sort_order
      `).all(row.id as number) as Array<Record<string, unknown>>
      return [
        ...(work ? [work] : []),
        ...actors.map((actor) => ({ kind: 'voice_actor' as const, id: Number(actor.id), displayName: this.namedSummary('voice_actor', actor).displayName })),
      ]
    }
    if (kind === 'voice_actor') {
      const characters = this.database.prepare(`
        SELECT c.* FROM character_voice_actor cva JOIN acg_character c ON c.id = cva.character_id
        WHERE cva.voice_actor_id = ? ORDER BY cva.sort_order
      `).all(row.id as number) as Array<Record<string, unknown>>
      return characters.flatMap((character) => {
        try {
          this.detail(user, 'character', Number(character.id))
          return [{ kind: 'character' as const, id: Number(character.id), displayName: this.namedSummary('character', character).displayName }]
        } catch { return [] }
      })
    }
    if (kind === 'publisher') {
      const labels = this.database.prepare('SELECT * FROM label WHERE publisher_id = ? ORDER BY name').all(row.id as number) as Array<Record<string, unknown>>
      return labels.flatMap((label) => {
        if (this.relatedSongs(user, 'label', Number(label.id)).length === 0) return []
        return [{ kind: 'label' as const, id: Number(label.id), displayName: this.namedSummary('label', label).displayName }]
      })
    }
    if (kind === 'label' && row.publisher_id) {
      if (this.relatedSongs(user, 'publisher', Number(row.publisher_id)).length === 0) return []
      const publisher = this.database.prepare('SELECT * FROM publisher WHERE id = ?').get(row.publisher_id as number) as Record<string, unknown> | undefined
      return publisher ? [{ kind: 'publisher', id: Number(publisher.id), displayName: this.namedSummary('publisher', publisher).displayName }] : []
    }
    if (kind === 'version_group' && row.work_id) {
      const work = this.visibleConnection(user, 'work', Number(row.work_id))
      return work ? [work] : []
    }
    return []
  }

  private visibleConnection(user: AuthUser, kind: 'work', id: number) {
    try {
      const work = this.database.prepare('SELECT * FROM work WHERE id = ?').get(id) as Record<string, unknown> | undefined
      if (!work) return undefined
      const rows = this.database.prepare('SELECT song_id FROM song_work WHERE work_id = ?').all(id) as Array<{ song_id: number }>
      if (!rows.some((item) => {
        try { this.songs.assertVisible(user, item.song_id); return true } catch { return false }
      })) return undefined
      return { kind, id, displayName: firstText(work.title_zh, work.title_ja, work.title_en, work.title_romaji) }
    } catch { return undefined }
  }

  private namedSummary(kind: AcgEntityKind, row: Record<string, unknown>): AcgEntitySummary {
    const displayName = kind === 'version_group'
      ? firstText(row.group_title)
      : firstText(row.name_zh, row.name_ja, row.name, row.name_en, row.name_romaji)
    const imageUrl = kind === 'voice_actor' ? row.avatar_url : row.image_url
    const secondaryText = kind === 'version_group'
        ? row.description
        : firstText(row.name_romaji, row.name_en)
    const normalizedImageUrl = optionalText(imageUrl)
    const normalizedSecondaryText = optionalText(secondaryText)
    return {
      id: row.id as number,
      displayName,
      ...(normalizedImageUrl ? { imageUrl: normalizedImageUrl } : {}),
      ...(normalizedSecondaryText && normalizedSecondaryText !== displayName ? { secondaryText: normalizedSecondaryText } : {}),
    }
  }

  private aliases(table: string, foreignKey: string, id: number): string[] {
    const rows = this.database.prepare(`SELECT alias_text FROM ${table} WHERE ${foreignKey} = ? ORDER BY alias_text`).all(id) as Array<{ alias_text: string }>
    return rows.map((row) => row.alias_text)
  }

  private replaceAliases(table: string, foreignKey: string, id: number, aliases: string[]): void {
    this.database.prepare(`DELETE FROM ${table} WHERE ${foreignKey} = ?`).run(id)
    const insert = this.database.prepare(`INSERT OR IGNORE INTO ${table}(${foreignKey}, alias_text, alias_type) VALUES (?, ?, 'alternate')`)
    for (const alias of new Set(aliases.map((value) => value.trim()).filter(Boolean))) insert.run(id, alias)
  }

  private visibleSongSql(): string {
    return "((s.review_status = 'approved' AND s.visibility = 'shared') OR s.submitted_by = ?)"
  }

  private entityProfile(kind: AcgEntityKind): EntityProfile {
    if (kind === 'creator') return {
      table: 'creator', aliasTable: 'creator_alias', aliasForeignKey: 'creator_id', primaryColumn: 'name',
      nameJaColumn: 'name_ja', nameZhColumn: 'name_zh', nameEnColumn: 'name_en', nameRomajiColumn: 'name_romaji',
      imageColumn: 'image_url', notFoundCode: 'creator_not_found', notFoundMessage: '创作者不存在',
    }
    if (kind === 'character') return {
      table: 'acg_character', aliasTable: 'character_alias', aliasForeignKey: 'character_id', primaryColumn: 'name',
      nameJaColumn: 'name_ja', nameZhColumn: 'name_zh', nameEnColumn: 'name_en', nameRomajiColumn: 'name_romaji',
      imageColumn: 'image_url', descriptionColumn: 'description', notFoundCode: 'character_not_found', notFoundMessage: '角色不存在',
    }
    if (kind === 'voice_actor') return {
      table: 'voice_actor', aliasTable: 'voice_actor_alias', aliasForeignKey: 'voice_actor_id', primaryColumn: 'name',
      nameJaColumn: 'name_ja', nameZhColumn: 'name_zh', nameEnColumn: 'name_en', nameRomajiColumn: 'name_romaji',
      imageColumn: 'avatar_url', notFoundCode: 'voice_actor_not_found', notFoundMessage: '声优不存在',
    }
    if (kind === 'publisher') return {
      table: 'publisher', aliasTable: 'publisher_alias', aliasForeignKey: 'publisher_id', primaryColumn: 'name',
      nameJaColumn: 'name_ja', nameZhColumn: 'name_zh', nameEnColumn: 'name_en', nameRomajiColumn: 'name_romaji',
      imageColumn: 'image_url', websiteColumn: 'website_url', notFoundCode: 'publisher_not_found', notFoundMessage: '发行商不存在',
    }
    if (kind === 'label') return {
      table: 'label', aliasTable: 'label_alias', aliasForeignKey: 'label_id', primaryColumn: 'name',
      nameJaColumn: 'name_ja', nameZhColumn: 'name_zh', nameEnColumn: 'name_en', nameRomajiColumn: 'name_romaji',
      imageColumn: 'image_url', notFoundCode: 'label_not_found', notFoundMessage: '厂牌不存在',
    }
    return {
      table: 'song_version_group', aliasTable: 'version_group_alias', aliasForeignKey: 'version_group_id', primaryColumn: 'group_title',
      imageColumn: 'image_url', descriptionColumn: 'description', notFoundCode: 'version_group_not_found', notFoundMessage: '歌曲版本组不存在',
    }
  }
}
