import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const originalAppOrigin = process.env.APP_ORIGIN
const originalLlmBaseUrl = process.env.LLM_BASE_URL
const originalLlmModel = process.env.LLM_MODEL

afterEach(() => {
  if (originalAppOrigin === undefined) delete process.env.APP_ORIGIN
  else process.env.APP_ORIGIN = originalAppOrigin
  if (originalLlmBaseUrl === undefined) delete process.env.LLM_BASE_URL
  else process.env.LLM_BASE_URL = originalLlmBaseUrl
  if (originalLlmModel === undefined) delete process.env.LLM_MODEL
  else process.env.LLM_MODEL = originalLlmModel
})

describe('application origins', () => {
  it('allows development web, Capacitor, and Tauri webview origins by default', () => {
    delete process.env.APP_ORIGIN
    expect(loadConfig().appOrigins).toEqual([
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'http://127.0.0.1:5174',
      'http://localhost:5174',
      'https://localhost',
      'capacitor://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
    ])
  })

  it('keeps explicit deployment origins and still allows native app webviews', () => {
    process.env.APP_ORIGIN = 'https://music.example.test,https://friends.example.test'
    expect(loadConfig().appOrigins).toEqual([
      'https://music.example.test',
      'https://friends.example.test',
      'https://localhost',
      'capacitor://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
    ])
  })
})

describe('AI provider defaults', () => {
  it('uses an external API when no provider environment variables are set', () => {
    delete process.env.LLM_BASE_URL
    delete process.env.LLM_MODEL

    const config = loadConfig()
    expect(config.llmBaseUrl).toBe('https://api.openai.com/v1')
    expect(config.llmModel).toBe('gpt-4o-mini')
  })
})
