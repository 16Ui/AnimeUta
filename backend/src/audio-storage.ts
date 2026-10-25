import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AppConfig } from './config.js'
import { assertApp } from './errors.js'

function inside(root: string, path: string): boolean {
  const resolvedRoot = existsSync(root) ? realpathSync(root) : resolve(root)
  const resolvedPath = existsSync(path) ? realpathSync(path) : resolve(path)
  const difference = relative(resolvedRoot, resolvedPath)
  return difference !== '' && difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference)
}

export function externalAudioUri(path: string, config: AppConfig): string {
  const absolutePath = resolve(path)
  assertApp(config.audioLibraryRoots?.some((root) => inside(root, absolutePath)), 400, 'audio_library_not_configured', '音频不在配置的原音乐目录中，请设置 AUDIO_LIBRARY_ROOTS')
  return pathToFileURL(absolutePath).href
}

export function resolveAudioPath(uri: string, config: AppConfig): string {
  if (uri.startsWith('file:')) {
    let absolutePath: string
    try {
      const url = new URL(uri)
      assertApp(!url.host, 400, 'invalid_audio_path', '不支持网络共享音频路径')
      absolutePath = fileURLToPath(url)
    } catch {
      assertApp(false, 400, 'invalid_audio_path', '音频路径无效')
    }
    externalAudioUri(absolutePath!, config)
    return absolutePath!
  }
  const absolutePath = resolve(config.mediaRoot, uri)
  assertApp(inside(config.mediaRoot, absolutePath), 400, 'invalid_audio_path', '音频路径无效')
  return absolutePath
}
