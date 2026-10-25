import test from 'node:test'
import assert from 'node:assert/strict'
import { mediaLinkExpired } from '../frontend/src/lib/playerMedia.ts'

test('restored signed audio and cover URLs are refreshed before expiry', () => {
  assert.equal(mediaLinkExpired('/api/v1/media/audio/1?expires=100&signature=test', 101_000), true)
  assert.equal(mediaLinkExpired('http://localhost:8080/api/v1/media/images/a.png?expires=100&signature=test', 80_000), true)
  assert.equal(mediaLinkExpired('/api/v1/media/audio/1?expires=200&signature=test', 100_000), false)
})
test('ordinary external and unsigned URLs are not treated as expired', () => {
  assert.equal(mediaLinkExpired('https://example.org/music.mp3'), false)
  assert.equal(mediaLinkExpired('/media/song.mp3'), false)
  assert.equal(mediaLinkExpired(undefined), false)
  assert.equal(mediaLinkExpired('/api/v1/media/audio/1?expires=broken&signature=test'), true)
})
