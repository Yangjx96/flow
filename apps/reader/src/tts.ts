import { TtsConfig } from './state'

function getWordCount(text: string): number {
  const t = text.trim().replace(/\s+/g, ' ')
  if (!t) return 0
  if (/[一-鿿぀-ヿ가-힯]/.test(t)) {
    return t.replace(/[^一-鿿぀-ヿ가-힯]/g, '').length
  }
  return t.split(/\s+/).length
}

function chooseApi(config: TtsConfig, text: string) {
  const count = getWordCount(text)
  const api = count <= config.threshold ? config.shortApi : config.longApi
  if (api.url && api.key) return api
  // fallback to whichever is configured
  if (config.shortApi.url && config.shortApi.key) return config.shortApi
  if (config.longApi.url && config.longApi.key) return config.longApi
  return null
}

let currentAudio: HTMLAudioElement | null = null

export function stopAudio() {
  if (currentAudio) {
    try {
      currentAudio.pause()
    } catch {}
    if (currentAudio.src?.startsWith('blob:')) URL.revokeObjectURL(currentAudio.src)
    currentAudio = null
  }
}

export async function playTts(
  text: string,
  config: TtsConfig,
): Promise<void> {
  const api = chooseApi(config, text)
  if (!api) return

  stopAudio()

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        apiUrl: api.url,
        apiKey: api.key,
        model: config.model,
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
  const api = config.shortApi.url ? config.shortApi : config.longApi
  if (!api.url || !api.key) return ''

  const chatUrl = api.url.replace(/\/audio\/speech$/, '/chat/completions')

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, apiUrl: chatUrl, apiKey: api.key }),
    })
    if (!res.ok) return ''
    const data = await res.json()
    return data.translation || ''
  } catch {
    return ''
  }
}
