import {
  TranslateSource,
  TtsConfig,
  activeLlmPreset,
  activeSources,
  activeTtsPreset,
} from './state'

let currentAudio: HTMLAudioElement | null = null
// generation counter: bumped on every stopAudio/playTts so that slow TTS
// responses from older triggers are dropped instead of piling up
let playSeq = 0

export function stopAudio() {
  playSeq++
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
  onEnded?: () => void,
): Promise<void> {
  // url/key may be supplied server-side via env, so only gate on the toggle
  if (!config.ttsEnabled) return

  stopAudio()
  const id = playSeq

  const api = activeTtsPreset(config)

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        apiUrl: api.url,
        apiKey: api.key,
        model: api.model || config.ttsModel || 'tts-1',
        voice: config.voice,
        speed: config.speed,
      }),
    })
    // a newer pronunciation started (or Esc stopped everything) meanwhile
    if (id !== playSeq || !res.ok) return

    const blob = await res.blob()
    if (id !== playSeq) return
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    currentAudio = audio
    audio.onended = () => {
      URL.revokeObjectURL(url)
      if (currentAudio === audio) currentAudio = null
      onEnded?.()
    }
    await audio.play()
  } catch {}
}

export async function translateText(
  text: string,
  config: TtsConfig,
  source?: TranslateSource,
): Promise<string> {
  if (!config.translateEnabled) return ''

  const method = source ?? activeSources(config)[0]
  const llm = activeLlmPreset(config)

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        method,
        apiUrl: llm.url,
        apiKey: llm.key,
        model: llm.model || undefined,
        systemPrompt: llm.systemPrompt || undefined,
      }),
    })
    if (!res.ok) return ''
    const data = await res.json()
    return data.translation || ''
  } catch {
    return ''
  }
}
