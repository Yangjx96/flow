// shared between the browser (direct upstream calls) and the API routes
// (server-side proxy) so the two paths never drift apart

export const DEFAULT_TRANSLATE_PROMPT =
  'You are a concise English-Chinese dictionary. For single words: give pronunciation (IPA), part of speech, and main Chinese meanings. For phrases/sentences: give only the Chinese translation. Keep it very short.'

export const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts'

// Thinking control, chosen per preset by the user. No max_tokens is sent —
// reasoning models count their thinking against it, and a capped budget came
// back as 200 with empty content (the original "silent dash" failure).
// deepseek only understands its native switch for "off"; every other value
// is the OpenAI-style reasoning_effort passed through verbatim, so any
// provider that speaks that dialect works too.
export function reasoningExtras(
  apiUrl: string | undefined,
  reasoning?: string,
): Record<string, unknown> {
  if (!reasoning) return {}
  let deepseek = false
  try {
    deepseek = new URL(apiUrl || '').hostname === 'api.deepseek.com'
  } catch {}
  if (reasoning === 'off')
    return deepseek
      ? { thinking: { type: 'disabled' } }
      : { reasoning_effort: 'none' }
  return { reasoning_effort: reasoning }
}

// tried in order when the upstream reports the requested model has no
// available channel (API relays retire models without notice — tts-1
// disappeared from qfgapi this way)
export const TTS_FALLBACK_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']
