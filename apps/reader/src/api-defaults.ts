// shared between the browser (direct upstream calls) and the API routes
// (server-side proxy) so the two paths never drift apart

export const DEFAULT_TRANSLATE_PROMPT =
  'You are a concise English-Chinese dictionary. For single words: give pronunciation (IPA), part of speech, and main Chinese meanings. For phrases/sentences: give only the Chinese translation. Keep it very short.'

export const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts'

// tried in order when the upstream reports the requested model has no
// available channel (API relays retire models without notice — tts-1
// disappeared from qfgapi this way)
export const TTS_FALLBACK_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']
