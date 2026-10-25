import { pathToFileURL } from 'node:url'
import type { AppConfig } from './config.js'
import { loadConfig } from './config.js'
import { LlmClient } from './llm.js'

export interface AiCheckResult {
  baseUrl: string
  model: string
  reply: string
}

export async function checkAiProvider(
  config: AppConfig,
  client = new LlmClient(config),
): Promise<AiCheckResult> {
  const result = await client.chatJson(
    'This is an AnimeUta provider readiness check. Return exactly one JSON object with ready=true and reply="animeuta".',
    { operation: 'provider_readiness_check' },
  )
  if (result.ready !== true || result.reply !== 'animeuta') {
    throw new Error('AI 服务已响应，但没有遵循 AnimeUta 的结构化 JSON 指令。')
  }
  return {
    baseUrl: config.llmBaseUrl,
    model: config.llmModel,
    reply: result.reply,
  }
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {
    // Process-level environment variables are sufficient when no local .env exists.
  }
  const config = loadConfig()
  process.stdout.write(`正在检查 AI 服务 ${config.llmBaseUrl}，模型 ${config.llmModel}...\n`)
  const result = await checkAiProvider(config)
  process.stdout.write(`AI 服务可用：${result.model} 返回了有效的结构化 JSON。\n`)
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined
if (entrypoint === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`AI 服务检查失败：${message}\n`)
    process.exitCode = 1
  })
}
