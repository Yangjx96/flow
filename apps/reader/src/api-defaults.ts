// shared between the browser (direct upstream calls) and the API routes
// (server-side proxy) so the two paths never drift apart

export const DEFAULT_TRANSLATE_PROMPT =
  'You are a concise English-Chinese dictionary. For single words: give pronunciation (IPA), part of speech, and main Chinese meanings. For phrases/sentences: give only the Chinese translation. Keep it very short.'

export const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts'

// generous because reasoning models spend their completion budget thinking
// before they write: deepseek-v4 burns 100-300 tokens of reasoning on a
// simple lookup, and with a tight cap the visible answer comes back empty
export const TRANSLATE_MAX_TOKENS = 1000

// deepseek's v4 models think by default; a dictionary lookup needs the
// answer, not the deliberation — thinking eats the token budget and
// triples latency, so switch it off on their endpoint explicitly
export function translatePayloadExtras(
  apiUrl: string,
): Record<string, unknown> {
  try {
    if (new URL(apiUrl).hostname === 'api.deepseek.com')
      return { thinking: { type: 'disabled' } }
  } catch {}
  return {}
}

// tried in order when the upstream reports the requested model has no
// available channel (API relays retire models without notice — tts-1
// disappeared from qfgapi this way)
export const TTS_FALLBACK_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']
