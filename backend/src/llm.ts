import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { AppConfig } from './config.js'
import { AppError } from './errors.js'

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>
}

export class LlmClient {
  constructor(private readonly config: AppConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.llmApiKey || !this.config.llmBaseUrl.includes('api.openai.com'))
  }

  async chatJson(system: string, input: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.config.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.llmApiKey ? { Authorization: `Bearer ${this.config.llmApiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.config.llmModel,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${system}\nReturn one valid JSON object only. Do not use Markdown fences.` },
          { role: 'user', content: JSON.stringify(input) },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    }).catch((error: unknown) => {
      throw new AppError(503, 'llm_unavailable', `无法连接 AI 服务：${error instanceof Error ? error.message : String(error)}`)
    })
    if (!response.ok) throw new AppError(502, 'llm_request_failed', `AI 服务返回 ${response.status}：${await response.text()}`)
    const payload = await response.json() as ChatResponse
    const content = payload.choices?.[0]?.message?.content?.trim()
    if (!content) throw new AppError(502, 'llm_empty_response', 'AI 服务没有返回内容')
    const normalized = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try {
      const parsed = JSON.parse(normalized) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root is not an object')
      return parsed as Record<string, unknown>
    } catch (error) {
      throw new AppError(502, 'llm_invalid_json', `AI 返回的 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async transcribe(audioPath: string, mimeType: string, language?: string): Promise<Record<string, unknown>> {
    const bytes = await readFile(audioPath)
    const form = new FormData()
    form.append('model', this.config.transcriptionModel)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'segment')
    form.append('timestamp_granularities[]', 'word')
    if (language) form.append('language', language)
    form.append('file', new Blob([bytes], { type: mimeType }), basename(audioPath))
    const baseUrl = this.config.transcriptionBaseUrl ?? this.config.llmBaseUrl
    const apiKey = this.config.transcriptionApiKey ?? this.config.llmApiKey
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout((this.config.transcriptionTimeoutSeconds ?? 1_800) * 1000),
    }).catch((error: unknown) => {
      throw new AppError(503, 'transcription_unavailable', `无法连接语音识别服务：${error instanceof Error ? error.message : String(error)}`)
    })
    if (!response.ok) throw new AppError(502, 'transcription_failed', `语音识别服务返回 ${response.status}：${await response.text()}`)
    const payload = await response.json() as unknown
    if (!payload || typeof payload !== 'object') throw new AppError(502, 'transcription_invalid', '语音识别结果格式无效')
    return payload as Record<string, unknown>
  }
}
