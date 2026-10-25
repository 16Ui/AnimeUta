import { loadConfig } from './config.js'
import { openDatabase, runMigrations } from './db.js'

try { process.loadEnvFile() } catch { /* Process environment is enough. */ }

const config = loadConfig()
const database = openDatabase(config.databasePath)
runMigrations(database)
database.close()

console.log(`SQLite migrations applied to ${config.databasePath}`)
