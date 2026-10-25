import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

export type SqliteDatabase = DatabaseSync

const migrationsDirectory = fileURLToPath(new URL('./migrations', import.meta.url))

export function openDatabase(databasePath: string): SqliteDatabase {
  mkdirSync(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  return database
}

export function runMigrations(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  const appliedRows = database.prepare('SELECT version FROM schema_migration').all() as Array<{ version: string }>
  const applied = new Set(appliedRows.map((row) => row.version))
  const files = readdirSync(migrationsDirectory)
    .filter((file) => extname(file) === '.sql')
    .sort((left, right) => left.localeCompare(right))

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(migrationsDirectory, file), 'utf8')
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(sql)
      database.prepare('INSERT INTO schema_migration(version) VALUES (?)').run(file)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function placeholders(values: readonly SQLInputValue[]): string {
  return values.map(() => '?').join(', ')
}
