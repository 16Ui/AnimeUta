import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = join(root, 'src', 'migrations')
const target = join(root, 'dist', 'migrations')
mkdirSync(target, { recursive: true })
for (const file of readdirSync(source)) if (file.endsWith('.sql')) copyFileSync(join(source, file), join(target, file))
