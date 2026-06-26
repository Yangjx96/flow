import { TtsConfig } from './state'

let currentAudio: HTMLAudioElement | null = null

export function stopAudio() {
  if (currentAudio) {
    try {
      currentAudio.pause()
    } catch {}
    if (currentAudio.src?.startsWith('blob:'))
      URL.revokeObjectURL(currentAudio.src)
    currentAudio = null
  }
}

export async function playTts(
  text: string,
  config: TtsConfig,
): Promise<void> {
  // url/key may be supplied server-side via env, so only gate on the toggle
  if (!config.ttsEnabled) return

  stopAudio()

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        apiUrl: config.ttsApi.url,
        apiKey: config.ttsApi.key,
        model: config.ttsModel || 'tts-1',
        voice: config.voice,
        speed: config.speed,
      }),
    })
    if (!res.ok) return

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    currentAudio = audio
    audio.onended = () => {
      URL.revokeObjectURL(url)
      if (currentAudio === audio) currentAudio = null
    }
    await audio.play()
  } catch {}
}

export async function translateText(
  text: string,
  config: TtsConfig,
): Promise<string> {
  if (!config.translateEnabled) return ''

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        method: config.translateMethod,
        apiUrl: config.llmApi.url,
        apiKey: config.llmApi.key,
      }),
    })
    if (!res.ok) return ''
    const data = await res.json()
    return data.translation || ''
  } catch {
    return ''
  }
}
