import { describe, expect, it } from 'vitest'
import { newerVersion } from '../../frontend/src/lib/clientUpdates'

describe('client version comparison', () => {
  it('compares numeric components rather than strings', () => {
    expect(newerVersion('0.1.10', '0.1.9')).toBe(true)
    expect(newerVersion('1.0.0', '0.99.99')).toBe(true)
  })
  it('does not offer equal, older or malformed versions', () => {
    expect(newerVersion('0.1.8', '0.1.8')).toBe(false)
    expect(newerVersion('0.1.7', '0.1.8')).toBe(false)
    expect(newerVersion('dev', '0.1.8')).toBe(false)
    expect(newerVersion('1.2.3', '')).toBe(false)
  })
})
