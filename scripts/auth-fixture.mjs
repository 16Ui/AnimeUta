import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
const sessions = new Set()
const user = { id: 1, email: 'qa@example.invalid', role: 'user' }
createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5188')
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Content-Type', 'application/json')
  const send = (status, data) => { res.writeHead(status); res.end(JSON.stringify({ data })) }
  if (req.method === 'OPTIONS') return send(204, null)
  if (req.url === '/api/v1/setup/status') return send(200, { needsOwner: false, registrationMode: 'closed' })
  if (req.url === '/api/v1/auth/login') {
    let raw = ''; for await (const part of req) raw += part
    const body = JSON.parse(raw)
    if (body.email !== user.email || body.password !== 'Fixture-password-123!') return send(401, null)
    const token = randomUUID(); sessions.add(token)
    return send(200, { token, refreshToken: randomUUID(), tokenType: 'Bearer', user })
  }
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!sessions.has(token)) return send(401, null)
  if (req.url === '/api/v1/auth/me') return send(200, user)
  if (req.url === '/api/v1/auth/logout') { sessions.delete(token); return send(200, null) }
  send(404, null)
}).listen(5189, '127.0.0.1', () => console.log('Isolated auth fixture on 5189; no production data'))
