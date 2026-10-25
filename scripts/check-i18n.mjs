import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('../frontend/node_modules/typescript')
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const frontendSource = join(projectRoot, 'frontend', 'src')
const backendSource = join(projectRoot, 'backend', 'src')
const i18nPath = join(frontendSource, 'i18n', 'index.ts')

function parse(path) {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

function unwrap(node) {
  while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression?.(node)) node = node.expression
  return node
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text
  return undefined
}

function objectProperty(object, name) {
  object = unwrap(object)
  if (!ts.isObjectLiteralExpression(object)) throw new Error(`Expected object while reading ${name}`)
  const property = object.properties.find((item) => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  if (!property || !ts.isPropertyAssignment(property)) throw new Error(`Missing i18n section: ${name}`)
  return unwrap(property.initializer)
}

function flattenKeys(node, prefix = '', result = new Set(), onDuplicate = () => {}) {
  node = unwrap(node)
  if (!ts.isObjectLiteralExpression(node)) {
    if (prefix) {
      if (result.has(prefix)) onDuplicate(prefix)
      result.add(prefix)
    }
    return result
  }
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = propertyName(property.name)
    if (!name) continue
    flattenKeys(property.initializer, prefix ? `${prefix}.${name}` : name, result, onDuplicate)
  }
  return result
}

const i18nSource = parse(i18nPath)
let resources
for (const statement of i18nSource.statements) {
  if (!ts.isVariableStatement(statement)) continue
  const declaration = statement.declarationList.declarations.find((item) => ts.isIdentifier(item.name) && item.name.text === 'resources')
  if (declaration?.initializer) resources = unwrap(declaration.initializer)
}
if (!resources) throw new Error('Could not find the i18n resources object')

const failures = []
const localeKeys = new Map()
for (const locale of ['en', 'zh', 'ja']) {
  localeKeys.set(locale, flattenKeys(
    objectProperty(objectProperty(resources, locale), 'translation'),
    '',
    new Set(),
    (key) => failures.push(`${locale} has a duplicate translation key: ${key}`),
  ))
}

const canonical = localeKeys.get('en')
for (const locale of ['zh', 'ja']) {
  const keys = localeKeys.get(locale)
  for (const key of canonical) if (!keys.has(key)) failures.push(`${locale} is missing translation key: ${key}`)
  for (const key of keys) if (!canonical.has(key)) failures.push(`${locale} has an extra translation key: ${key}`)
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return ['.ts', '.tsx'].includes(extname(path)) ? [path] : []
  })
}

const allowedVisibleText = new Set([
  'AnimeUta',
  'AU',
  'MP3 / FLAC / M4A / WAV / OGG',
  'LRC / SRT / TXT',
])

function allowedLiteral(value) {
  return allowedVisibleText.has(value) || /^https?:\/\//i.test(value)
}

for (const path of sourceFiles(frontendSource)) {
  const source = parse(path)
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      const key = node.arguments[0]
      if (key && ts.isStringLiteral(key) && !canonical.has(key.text)) {
        failures.push(`${path}:${source.getLineAndCharacterOfPosition(key.getStart()).line + 1} references missing key: ${key.text}`)
      }
    }
    if (ts.isJsxText(node)) {
      const visible = node.text.replace(/\s+/g, ' ').trim()
      if (visible && /[A-Za-z\u3040-\u30ff\u3400-\u9fff]/u.test(visible) && !allowedLiteral(visible)) {
        failures.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} contains raw visible text: ${visible}`)
      }
    }
    if (ts.isJsxAttribute(node) && ['placeholder', 'title', 'aria-label'].includes(node.name.text) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const visible = node.initializer.text.trim()
      if (visible && /[A-Za-z\u3040-\u30ff\u3400-\u9fff]/u.test(visible) && !allowedLiteral(visible)) {
        failures.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} contains raw ${node.name.text}: ${visible}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

const backendErrorCodes = new Set()
for (const path of sourceFiles(backendSource).filter((path) => !path.endsWith('.test.ts'))) {
  const source = parse(path)
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'assertApp') {
      const code = node.arguments[2]
      if (code && ts.isStringLiteral(code)) backendErrorCodes.add(code.text)
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'AppError') {
      const code = node.arguments?.[1]
      if (code && ts.isStringLiteral(code)) backendErrorCodes.add(code.text)
    }
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'notFoundCode') {
      const code = unwrap(node.initializer)
      if (ts.isStringLiteral(code)) backendErrorCodes.add(code.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

for (const code of [...backendErrorCodes].sort()) {
  const key = `apiErrors.${code}`
  if (!canonical.has(key)) failures.push(`backend error code has no translation: ${code}`)
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`i18n audit passed: ${canonical.size} keys across en, zh and ja; ${backendErrorCodes.size} backend error codes covered.`)
}
