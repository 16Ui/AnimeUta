import { AuthService } from './auth.js'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { openDatabase, runMigrations } from './db.js'

try {
  process.loadEnvFile()
} catch {
  // Environment variables supplied by the process are sufficient in production.
}

const config = loadConfig()
const database = openDatabase(config.databasePath)
runMigrations(database)
const auth = new AuthService(database, config)
await auth.bootstrapOwner()
const app = await buildApp(config, database, auth)

const close = async () => {
  await app.close()
  database.close()
  process.exit(0)
}

process.on('SIGINT', () => void close())
process.on('SIGTERM', () => void close())

await app.listen({ host: config.host, port: config.port })
