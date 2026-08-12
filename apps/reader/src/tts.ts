import {
  DEFAULT_TRANSLATE_PROMPT,
  DEFAULT_TTS_MODEL,
  reasoningExtras,
} from './api-defaults'
import {
  TranslateSource,
  TtsConfig,
  activeLlmPreset,
  activeSources,
  activeTtsPreset,
} from './state'

// When the active preset carries its own url+key, the browser talks to the
// upstream API directly (one hop) and only falls back to our /api proxy when
// that fails — CORS-blocked relay, mixed content, flaky route, whatever. The
// proxy hop rides browser → CDN → VPS → upstream, so skipping it both cuts
// latency and removes two failure points. Presets without a key (family
// accounts relying on the server-side env key) always use the proxy.
const DIRECT_TIMEOUT = 15_000
const PROXY_TTS_TIMEOUT = 30_000
const PROXY_TRANSLATE_TIMEOUT = 30_000

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() =>
    clearTimeout(timer),
  )
}

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

async function fetchTtsBlob(
  text: string,
  config: TtsConfig,
): Promise<Blob | null> {
  const api = activeTtsPreset(config)
  const model = api.model || config.ttsModel || DEFAULT_TTS_MODEL
  const voice = config.voice
  const speed = config.speed

  if (api.url && api.key) {
    try {
      const res = await fetchWithTimeout(
        api.url,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${api.key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            input: text,
            voice: voice || 'alloy',
            speed: speed || 1.0,
          }),
        },
        DIRECT_TIMEOUT,
      )
      if (res.ok) return await res.blob()
    } catch {}
    // fall through to the proxy (which also retries sibling models when the
    // relay has retired the requested one)
  }

  try {
    const res = await fetchWithTimeout(
      '/api/tts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          apiUrl: api.url,
          apiKey: api.key,
          model,
          voice,
          speed,
        }),
      },
      PROXY_TTS_TIMEOUT,
    )
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
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

  const blob = await fetchTtsBlob(text, config)
  // a newer pronunciation started (or Esc stopped everything) meanwhile
  if (id !== playSeq) return
  if (!blob) {
    // audio failed: still fire the callback so the auto-dismiss chain
    // (which waits for "pronunciation finished") is never left hanging
    onEnded?.()
    return
  }

  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  currentAudio = audio
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    URL.revokeObjectURL(url)
    if (currentAudio === audio) currentAudio = null
    onEnded?.()
  }
  audio.onended = finish
  audio.onerror = finish
  try {
    await audio.play()
  } catch {
    // autoplay blocked / decode failure: treat as ended so the
    // auto-dismiss flow is never left hanging
    finish()
  }
}

async function directLlmTranslate(
  text: string,
  llm: {
    url?: string
    key?: string
    model?: string
    systemPrompt?: string
    reasoning?: string
  },
): Promise<string | null> {
  if (!llm.url || !llm.key) return null
  try {
    const res = await fetchWithTimeout(
      llm.url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${llm.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: llm.model || 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: llm.systemPrompt || DEFAULT_TRANSLATE_PROMPT,
            },
            { role: 'user', content: text },
          ],
          temperature: 0.3,
          ...reasoningExtras(llm.url, llm.reasoning),
        }),
      },
      DIRECT_TIMEOUT,
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  } catch {
    return null
  }
}

export async function translateText(
  text: string,
  config: TtsConfig,
  source?: TranslateSource,
): Promise<string> {
  if (!config.translateEnabled) return ''

  const method = source ?? activeSources(config)[0]
  const llm = activeLlmPreset(config)

  // google must go through the proxy: translate.googleapis.com is not
  // reachable from every client network, while the VPS answers in ~100ms
  if (method === 'llm') {
    const direct = await directLlmTranslate(text, llm)
    if (direct !== null) return direct
  }

  try {
    const res = await fetchWithTimeout(
      '/api/translate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          method,
          apiUrl: llm.url,
          apiKey: llm.key,
          model: llm.model || undefined,
          systemPrompt: llm.systemPrompt || undefined,
          reasoning: llm.reasoning || undefined,
        }),
      },
      PROXY_TRANSLATE_TIMEOUT,
    )
    if (!res.ok) return ''
    const data = await res.json()
    return data.translation || ''
  } catch {
    return ''
  }
}
