import { openDatabase, runMigrations, nowIso } from './db.js'
import { loadConfig } from './config.js'
import { hashPassword } from './security.js'

try { process.loadEnvFile() } catch { /* Environment variables are optional. */ }

function argument(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

const email = argument('email')?.trim().toLowerCase()
const password = argument('password')
if (!email || !password) {
  throw new Error('Usage: npm run account:reset-password -- --email=user@example.com --password=new-password')
}
if (password.length < 8 || password.length > 128) {
  throw new Error('Password must contain 8 to 128 characters.')
}

const config = loadConfig()
const database = openDatabase(config.databasePath)
try {
  runMigrations(database)
  const user = database.prepare('SELECT id FROM app_user WHERE email = ?').get(email) as { id: number } | undefined
  if (!user) throw new Error(`Account not found: ${email}`)
  const { hash, salt } = await hashPassword(password)
  const now = nowIso()
  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare('UPDATE app_user SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?').run(hash, salt, now, user.id)
    database.prepare('UPDATE auth_session SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, now, user.id)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  console.log(`Password reset for ${email}. Existing sessions were revoked.`)
} finally {
  database.close()
}
