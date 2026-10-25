import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppConfig } from './config.js'
import { checkAiProvider } from './check-ai.js'
import { LlmClient } from './llm.js'

const servers: Server[] = []

function config(baseUrl: string): AppConfig {
  return {
    host: '127.0.0.1', port: 0, databasePath: '', mediaRoot: '', appOrigins: [], registrationMode: 'invite',
    friendShareReview: true, bootstrapAdminName: 'Owner', accessTokenTtlMinutes: 30, refreshTokenTtlDays: 30,
    maxAudioBytes: 1024, maxImageBytes: 1024, mediaSigningSecret: 'test', llmBaseUrl: baseUrl,
    llmModel: 'test-model', transcriptionModel: 'test-transcription', aiDailyLimit: 20,
  }
}

async function listen(body: unknown, statusCode = 200, inspect?: (request: import('node:http').IncomingMessage) => void): Promise<string> {
  const server = createServer((request, response) => {
    inspect?.(request)
    response.writeHead(statusCode, { 'Content-Type': 'application/json' })
    response.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port')
  return `http://127.0.0.1:${address.port}/v1`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
})

describe('OpenAI-compatible LLM client', () => {
  it('passes a real structured provider readiness response', async () => {
    const baseUrl = await listen({ choices: [{ message: { content: '{"ready":true,"reply":"animeuta"}' } }] })
    await expect(checkAiProvider(config(baseUrl))).resolves.toMatchObject({
      baseUrl,
      model: 'test-model',
      reply: 'animeuta',
    })
  })

  it('rejects a provider that ignores the structured readiness contract', async () => {
    const baseUrl = await listen({ choices: [{ message: { content: '{"ready":true,"reply":"hello"}' } }] })
    await expect(checkAiProvider(config(baseUrl)))
      .rejects.toThrow('没有遵循 AnimeUta 的结构化 JSON 指令')
  })

  it('parses one JSON object from a compatible chat response', async () => {
    const baseUrl = await listen({ choices: [{ message: { content: '{"lines":[]}' } }] })
    await expect(new LlmClient(config(baseUrl)).chatJson('Return lines', {})).resolves.toEqual({ lines: [] })
  })

  it('rejects invalid JSON instead of treating it as a successful task result', async () => {
    const baseUrl = await listen({ choices: [{ message: { content: 'not-json' } }] })
    await expect(new LlmClient(config(baseUrl)).chatJson('Return JSON', {}))
      .rejects.toMatchObject({ code: 'llm_invalid_json', statusCode: 502 })
  })

  it('preserves provider failures as a visible gateway error', async () => {
    const baseUrl = await listen('provider unavailable', 503)
    await expect(new LlmClient(config(baseUrl)).chatJson('Return JSON', {}))
      .rejects.toMatchObject({ code: 'llm_request_failed', statusCode: 502 })
  })

  it('can route transcription to a separate compatible provider and key', async () => {
    let requestPath = ''
    let authorization = ''
    const transcriptionBaseUrl = await listen({ text: '', segments: [] }, 200, (request) => {
      requestPath = request.url ?? ''
      authorization = request.headers.authorization ?? ''
    })
    const clientConfig = config('http://127.0.0.1:1/v1')
    clientConfig.transcriptionBaseUrl = transcriptionBaseUrl
    clientConfig.transcriptionApiKey = 'speech-test-key'
    const fixture = fileURLToPath(new URL('../package.json', import.meta.url))

    await expect(new LlmClient(clientConfig).transcribe(fixture, 'audio/mpeg', 'ja')).resolves.toMatchObject({ segments: [] })
    expect(requestPath).toBe('/v1/audio/transcriptions')
    expect(authorization).toBe('Bearer speech-test-key')
  })
})
