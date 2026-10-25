const voicePreferenceKey = 'animeuta.study.japaneseVoice'

function voiceScore(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase()
  let score = voice.lang.toLowerCase().startsWith('ja') ? 100 : 0
  if (/natural|neural|online/.test(name)) score += 50
  if (/nanami|keita|ayumi|haruka|google.*日本語|google.*japanese/.test(name)) score += 30
  if (voice.localService) score += 5
  return score
}

export function japaneseVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return []
  return window.speechSynthesis.getVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith('ja'))
    .sort((left, right) => voiceScore(right) - voiceScore(left) || left.name.localeCompare(right.name))
}

export function preferredJapaneseVoiceName(): string {
  return localStorage.getItem(voicePreferenceKey) ?? ''
}

export function savePreferredJapaneseVoiceName(name: string): void {
  if (name) localStorage.setItem(voicePreferenceKey, name)
  else localStorage.removeItem(voicePreferenceKey)
}

export function speakJapanese(text: string, preferredName = preferredJapaneseVoiceName()): boolean {
  if (!text.trim() || typeof window === 'undefined' || !('speechSynthesis' in window)) return false
  const voices = japaneseVoices()
  const voice = voices.find((item) => item.name === preferredName) ?? voices[0]
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ja-JP'
  utterance.rate = 0.9
  utterance.pitch = 1
  if (voice) utterance.voice = voice
  window.speechSynthesis.speak(utterance)
  return true
}
