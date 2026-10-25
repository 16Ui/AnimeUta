import { describe, expect, it } from 'vitest'
import { normalizeImageUri } from './media.js'

describe('normalizeImageUri', () => {
  it('stores a stable path instead of a signed API URL', () => {
    expect(normalizeImageUri('/api/v1/media/images/cover-1.jpg?expires=123&signature=temporary'))
      .toBe('/media/images/cover-1.jpg')
    expect(normalizeImageUri('http://127.0.0.1:8080/api/v1/media/images/avatar.png?expires=123&signature=temporary'))
      .toBe('/media/images/avatar.png')
  })

  it('preserves valid external image URLs', () => {
    expect(normalizeImageUri('https://images.example.com/cover.jpg'))
      .toBe('https://images.example.com/cover.jpg')
  })

  it('does not normalize unsafe media names', () => {
    expect(normalizeImageUri('/api/v1/media/images/%2E%2E'))
      .toBe('/api/v1/media/images/%2E%2E')
  })
})
