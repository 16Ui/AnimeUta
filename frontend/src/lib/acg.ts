import type { AcgEntityKind } from '../types/content'

export function acgEntityPath(kind: AcgEntityKind | 'work', id: number): string {
  if (kind === 'work') return `/work/${id}`
  if (kind === 'voice_actor') return `/voice-actor/${id}`
  if (kind === 'version_group') return `/version-group/${id}`
  return `/${kind}/${id}`
}
