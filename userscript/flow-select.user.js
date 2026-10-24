// ==UserScript==
// @name         Flow 划词
// @namespace    https://github.com/Yangjx96/flow
// @version      1.0.1
// @description  把 Flow 阅读器的划词翻译和朗读带到普通网页。默认只在经济学人生效，其他网站在设置里添加。
// @author       Yangjx96
// @license      AGPL-3.0
// @match        *://*/*
// @noframes
// @run-at       document-idle
// @sandbox      DOM
// @inject-into  content
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      yangyichuan.com
// @connect      deepseek.com
// @connect      oaipro.com
// @connect      qfgapi.com
// @connect      googleapis.com
// @connect      *
// @homepageURL  https://github.com/Yangjx96/flow/tree/main/userscript
// @updateURL    https://raw.githubusercontent.com/Yangjx96/flow/main/userscript/flow-select.user.js
// @downloadURL  https://raw.githubusercontent.com/Yangjx96/flow/main/userscript/flow-select.user.js
// ==/UserScript==

// Selection translate + pronounce from the Flow reader, for ordinary web
// pages. Word snapping, the popup and the translate/TTS timing are ported
// from apps/reader/src/components/SelectionPopup.tsx and apps/reader/src/tts.ts
// — change those and this together.

;(function () {
  'use strict'

  if (window.__flowSelect) return
  window.__flowSelect = true

  // ---- shared with apps/reader/src/api-defaults.ts ------------------------

  const DEFAULT_TRANSLATE_PROMPT =
    'You are a concise English-Chinese dictionary. For single words: give pronunciation (IPA), part of speech, and main Chinese meanings. For phrases/sentences: give only the Chinese translation. Keep it very short.'

  const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts'

  // tried in order when the upstream reports the requested model has no
  // available channel (relays retire models without notice)
  const TTS_FALLBACK_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']

  // per-preset thinking control; see reasoningExtras in api-defaults.ts
  function reasoningExtras(apiUrl, reasoning) {
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

  // ---- settings -------------------------------------------------------------

  const DIRECT_TIMEOUT = 15000
  const GOOGLE_TIMEOUT = 6000
  const PROXY_TIMEOUT = 30000
  // minimum time the finished translation stays readable before auto-close
  const READ_GRACE = 2500
  // how often "follow Flow" re-checks Flow's settings on page load
  const SYNC_EVERY = 10 * 60 * 1000

  const DEFAULT_DOMAINS = ['economist.com']
  const LLM_MODELS = [
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4.1-mini',
    'deepseek-chat',
    'deepseek-reasoner',
    'gemini-2.0-flash',
    'claude-3-5-haiku-latest',
  ]
  const TTS_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']
  const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

  // same fields as Flow's TtsConfig (state.ts), so the settings pulled from
  // Flow's sync endpoint drop straight in
  const defaultCfg = {
    ttsEnabled: true,
    translateEnabled: true,
    autoOnSelect: false,
    translateShortcut: 'd',
    ttsShortcut: 's',
    translateMethod: 'llm',
    translateSources: ['llm'],
    llmApi: { url: '', key: '' },
    ttsApi: { url: '', key: '' },
    ttsModel: 'gpt-4o-mini-tts',
    voice: 'alloy',
    speed: 1.0,
    ttsMaxWords: 30,
    autoDismiss: true,
    snapToWords: true,
    clickSelectsWord: false,
    hoverSelectsWord: false,
  }

  // userscript-only preferences
  const defaultPrefs = {
    flowUrl: 'https://flow.yangyichuan.com',
    // re-pull the translate/TTS settings whenever they change in Flow
    followFlow: true,
    // popup colors: follow the page background, or force light / dark
    theme: 'auto',
  }

  function load(key, fallback) {
    try {
      const v = GM_getValue(key)
      return v === undefined || v === null ? fallback : v
    } catch {
      return fallback
    }
  }

  function store(key, value) {
    try {
      GM_setValue(key, value)
    } catch {}
  }

  function loadSize() {
    const s = load('popupSize', null)
    return s && s.w ? { w: s.w, h: s.h || null } : { w: 60, h: null }
  }

  const firstRun = load('cfg', null) === null
  let domains = cleanDomains(load('domains', DEFAULT_DOMAINS))
  let cfg = { ...defaultCfg, ...load('cfg', {}) }
  let prefs = { ...defaultPrefs, ...load('prefs', {}) }
  let size = loadSize()
  // the last pull from Flow
  let syncInfo = { at: 0, ok: false, msg: '', updatedAt: 0, ...load('flowSync', {}) }

  // the sources to query for a translation, in display order
  function activeSources(c) {
    return c.translateSources && c.translateSources.length
      ? c.translateSources
      : [c.translateMethod]
  }

  // active preset, falling back to the legacy single-config fields
  function activeLlmPreset(c) {
    const list = c.llmPresets || []
    return (
      list.find((p) => p.id === c.llmActiveId) ||
      list[0] || {
        id: '',
        name: '',
        url: (c.llmApi && c.llmApi.url) || '',
        key: (c.llmApi && c.llmApi.key) || '',
      }
    )
  }

  function activeTtsPreset(c) {
    const list = c.ttsPresets || []
    return (
      list.find((p) => p.id === c.ttsActiveId) ||
      list[0] || {
        id: '',
        name: '',
        url: (c.ttsApi && c.ttsApi.url) || '',
        key: (c.ttsApi && c.ttsApi.key) || '',
        model: c.ttsModel,
      }
    )
  }

  // ---- sites ------------------------------------------------------------------

  // "https://www.economist.com/x", "www.economist.com", "economist.com"
  // all become "economist.com"; '' when it isn't a usable host name.
  // strict (typed input) wants a dot so a stray word isn't taken for a host;
  // otherwise single-label hosts (nas, intranet) and IPv6 pass too
  function normalizeDomain(input, strict = false) {
    let t = String(input || '')
      .trim()
      .toLowerCase()
      .replace(/^\*\./, '')
    if (!t) return ''
    try {
      t = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(t) ? t : `http://${t}`)
        .hostname
    } catch {
      return ''
    }
    t = t.replace(/^www\./, '').replace(/\.$/, '')
    if (/^\[[0-9a-f:.]+\]$/.test(t)) return t
    if (t === 'localhost') return t
    return (strict ? /^[a-z0-9-]+(\.[a-z0-9-]+)+$/ : /^[a-z0-9-]+(\.[a-z0-9-]+)*$/).test(t)
      ? t
      : ''
  }

  function cleanDomains(list) {
    if (!Array.isArray(list)) return DEFAULT_DOMAINS.slice()
    return [...new Set(list.map((d) => normalizeDomain(d)).filter(Boolean))]
  }

  // a listed domain covers itself and every subdomain
  function coveredBy(host, d) {
    return host === d || host.endsWith(`.${d}`)
  }

  const currentHost = () => location.hostname.toLowerCase()
  const enabledHere = () => domains.some((d) => coveredBy(currentHost(), d))
  // what "enable here" adds: the host without its www.
  const siteKey = () => normalizeDomain(currentHost()) || currentHost()

  function setDomains(list) {
    domains = cleanDomains(list)
    store('domains', domains)
    applyEnabled()
    scheduleRender()
  }

  function toggleHere() {
    if (enabledHere()) {
      const host = currentHost()
      setDomains(domains.filter((d) => !coveredBy(host, d)))
      toast(`已在 ${host} 停用划词`)
    } else {
      setDomains([...domains, siteKey()])
      toast(`已在 ${siteKey()} 启用划词`)
    }
  }

  let menuIds = []
  function refreshMenus() {
    if (typeof GM_registerMenuCommand !== 'function') return
    const canUpdate = typeof GM_unregisterMenuCommand === 'function'
    // without unregister support, keep the first labels instead of stacking
    if (menuIds.length && !canUpdate) return
    menuIds.forEach((id) => {
      try {
        GM_unregisterMenuCommand(id)
      } catch {}
    })
    menuIds = [
      GM_registerMenuCommand(
        enabledHere()
          ? `在 ${currentHost()} 停用划词`
          : `在 ${siteKey()} 启用划词`,
        toggleHere,
      ),
      GM_registerMenuCommand('设置', openSettings),
    ]
  }

  // ---- requests -------------------------------------------------------------

  // GM_xmlhttpRequest is not bound by the page's CORS or CSP; always resolves
  function gmRequest(opts) {
    return new Promise((resolve) => {
      const fail = () =>
        resolve({ ok: false, status: 0, text: '', response: null, headers: '' })
      try {
        GM_xmlhttpRequest({
          ...opts,
          onload: (r) => {
            const ok = r.status >= 200 && r.status < 300
            let text = ''
            if (opts.responseType === 'arraybuffer') {
              if (!ok && r.response) {
                try {
                  text = new TextDecoder().decode(r.response)
                } catch {}
              }
            } else {
              text = r.responseText || ''
            }
            resolve({
              ok,
              status: r.status,
              text,
              response: r.response,
              headers: r.responseHeaders || '',
            })
          },
          onerror: fail,
          ontimeout: fail,
          onabort: fail,
        })
      } catch {
        fail()
      }
    })
  }

  function contentType(headers) {
    const m = /^content-type:\s*([^;\r\n]+)/im.exec(headers || '')
    return m ? m[1].trim().toLowerCase() : ''
  }

  const flowBase = () => (prefs.flowUrl || '').trim().replace(/\/+$/, '')

  // A preset with its own url+key is called directly (one hop, no CORS in a
  // userscript); anything that fails falls back to Flow's /api proxy, which
  // rides the browser's Flow login and the server-side env keys.
  async function directLlmTranslate(text, llm) {
    if (!llm.url || !llm.key) return null
    const r = await gmRequest({
      method: 'POST',
      url: llm.url,
      headers: {
        Authorization: `Bearer ${llm.key}`,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify({
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
      timeout: DIRECT_TIMEOUT,
      anonymous: true,
    })
    if (!r.ok) return null
    try {
      const data = JSON.parse(r.text)
      return (
        (data.choices &&
          data.choices[0] &&
          data.choices[0].message &&
          data.choices[0].message.content) ||
        ''
      )
    } catch {
      return null
    }
  }

  // translate.googleapis.com is unreachable from some networks; after one
  // failed direct call this page goes straight to Flow's proxy instead of
  // waiting out the timeout on every lookup
  let googleDirect = true

  async function directGoogleTranslate(text) {
    if (!googleDirect) return null
    const params = new URLSearchParams({
      client: 'gtx',
      sl: 'auto',
      tl: 'zh-CN',
      dt: 't',
      q: text,
    })
    const r = await gmRequest({
      method: 'GET',
      url: `https://translate.googleapis.com/translate_a/single?${params}`,
      timeout: GOOGLE_TIMEOUT,
      anonymous: true,
    })
    if (!r.ok) {
      googleDirect = false
      return null
    }
    try {
      const sentences = JSON.parse(r.text)[0]
      if (!Array.isArray(sentences)) return null
      return sentences.map((s) => (s && s[0]) || '').join('')
    } catch {
      return null
    }
  }

  async function proxyTranslate(text, method, llm) {
    const base = flowBase()
    if (!base) return ''
    const r = await gmRequest({
      method: 'POST',
      url: `${base}/api/translate`,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        text,
        method,
        apiUrl: llm.url,
        apiKey: llm.key,
        model: llm.model || undefined,
        systemPrompt: llm.systemPrompt || undefined,
        reasoning: llm.reasoning || undefined,
      }),
      timeout: PROXY_TIMEOUT,
    })
    // a lapsed Flow login comes back as the sign-in page
    if (!r.ok || !/json/.test(contentType(r.headers))) return ''
    try {
      return JSON.parse(r.text).translation || ''
    } catch {
      return ''
    }
  }

  async function translateText(text, source) {
    if (!cfg.translateEnabled) return ''
    const method = source || activeSources(cfg)[0]
    const llm = activeLlmPreset(cfg)
    const direct =
      method === 'llm'
        ? await directLlmTranslate(text, llm)
        : await directGoogleTranslate(text)
    if (direct !== null) return direct
    return proxyTranslate(text, method, llm)
  }

  // relays retire models without notice; recognize their "no channel" reply
  // so the same request can be retried with a sibling model
  function isModelGone(status, body) {
    return (
      (status === 404 || status === 503) &&
      /no available channel|model_not_found|does not exist/i.test(body)
    )
  }

  async function fetchTtsAudio(text) {
    const api = activeTtsPreset(cfg)
    const model = api.model || cfg.ttsModel || DEFAULT_TTS_MODEL
    const voice = cfg.voice || 'alloy'
    const speed = cfg.speed || 1.0

    if (api.url && api.key) {
      const candidates = [
        model,
        ...TTS_FALLBACK_MODELS.filter((m) => m !== model),
      ]
      for (const m of candidates) {
        const r = await gmRequest({
          method: 'POST',
          url: api.url,
          headers: {
            Authorization: `Bearer ${api.key}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify({ model: m, input: text, voice, speed }),
          responseType: 'arraybuffer',
          timeout: DIRECT_TIMEOUT,
          anonymous: true,
        })
        if (r.ok && r.response) return r.response
        if (!isModelGone(r.status, r.text)) break
      }
    }

    const base = flowBase()
    if (!base) return null
    const r = await gmRequest({
      method: 'POST',
      url: `${base}/api/tts`,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        text,
        apiUrl: api.url,
        apiKey: api.key,
        model,
        voice,
        speed,
      }),
      responseType: 'arraybuffer',
      timeout: PROXY_TIMEOUT,
    })
    if (!r.ok || !r.response || /html|json/.test(contentType(r.headers)))
      return null
    return r.response
  }

  // ---- audio ------------------------------------------------------------------

  let audioCtx = null
  // stops the current playback without reporting it as ended
  let currentStop = null
  // generation counter: bumped on every stopAudio/playTts so that slow TTS
  // responses from older triggers are dropped instead of piling up
  let playSeq = 0
  let suspendTimer = null

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // call from inside a user gesture (mouseup / keydown): that is when the
  // browser lets an audio context start
  function primeAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext
        if (AC) audioCtx = new AC()
      }
      if (audioCtx && audioCtx.state === 'suspended')
        audioCtx.resume().catch(() => {})
    } catch {}
  }

  function stopAudio() {
    playSeq++
    if (currentStop) {
      const stop = currentStop
      currentStop = null
      stop()
    }
  }

  // Web Audio first: decoding a buffer loads no media URL, so a strict page
  // CSP (media-src) can't block it. <audio> + blob URL is the fallback.
  async function playBuffer(buf, id, finish) {
    clearTimeout(suspendTimer)
    const done = () => {
      // release the audio device once things go quiet
      clearTimeout(suspendTimer)
      suspendTimer = setTimeout(() => {
        if (!currentStop && audioCtx && audioCtx.state === 'running')
          audioCtx.suspend().catch(() => {})
      }, 3000)
      finish()
    }
    if (audioCtx) {
      try {
        const audio = await audioCtx.decodeAudioData(buf.slice(0))
        if (id !== playSeq) return
        if (audioCtx.state !== 'running') {
          await Promise.race([audioCtx.resume(), sleep(500)]).catch(() => {})
          if (id !== playSeq) return
        }
        if (audioCtx.state === 'running') {
          const src = audioCtx.createBufferSource()
          src.buffer = audio
          src.connect(audioCtx.destination)
          src.onended = done
          currentStop = () => {
            src.onended = null
            try {
              src.stop()
            } catch {}
          }
          src.start()
          return
        }
      } catch {}
    }
    if (id !== playSeq) return
    let url = ''
    try {
      url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }))
      const el = new Audio(url)
      const end = () => {
        URL.revokeObjectURL(url)
        done()
      }
      el.onended = end
      el.onerror = end
      currentStop = () => {
        el.onended = null
        el.onerror = null
        try {
          el.pause()
        } catch {}
        URL.revokeObjectURL(url)
      }
      await el.play()
    } catch {
      // autoplay blocked / decode failure: treat as ended so the
      // auto-dismiss flow is never left hanging
      if (url) URL.revokeObjectURL(url)
      if (id === playSeq) done()
    }
  }

  async function playTts(text, onEnded) {
    if (!cfg.ttsEnabled) return
    stopAudio()
    const id = playSeq
    const buf = await fetchTtsAudio(text)
    // a newer pronunciation started (or Esc stopped everything) meanwhile
    if (id !== playSeq) return
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      if (id === playSeq) currentStop = null
      if (onEnded) onEnded()
    }
    // audio failed: still report it as ended so the auto-dismiss chain
    // (which waits for "pronunciation finished") is never left hanging
    if (!buf) return finish()
    await playBuffer(buf, id, finish)
  }

  // ---- word snapping (ported from SelectionPopup.tsx) -------------------------

  // a "word" stays together across letters, digits, accents and apostrophes;
  // hyphens, dashes, brackets and other punctuation are breaks. Soft hyphens /
  // zero-width marks are invisible line-break hints publishers embed
  // mid-word, so they count as word chars (and are stripped before sending)
  function isWordChar(ch) {
    return !!ch && /[A-Za-z0-9\u00C0-\u024F\u2019'\u00AD\u200B-\u200D\uFEFF]/.test(ch)
  }

  // an element that can sit inside a word: any inline box, plus a floated
  // drop cap (the Economist opens articles with
  // <span data-caps="initial">I</span><small>T IS</small>, and "IT" must
  // snap as one word)
  function joinsWord(el, win) {
    let s
    try {
      s = win.getComputedStyle(el)
    } catch {
      return false
    }
    if (s.display.startsWith('inline')) return true
    const float = s.cssFloat || s.getPropertyValue('float')
    return (
      !!float && float !== 'none' && (el.textContent || '').trim().length <= 2
    )
  }

  // true when the two text nodes are separated only by inline elements, i.e.
  // their characters render as one unbroken run ("pre<i>ci</i>sion")
  function onlyInlineBetween(a, b, bIsBefore) {
    const doc = a.ownerDocument
    const win = doc && doc.defaultView
    if (!doc || !win) return false
    const probe = doc.createRange()
    try {
      probe.setStart(bIsBefore ? b : a, 0)
      probe.setEnd(bIsBefore ? a : b, 0)
    } catch {
      return false
    }
    const ca = probe.commonAncestorContainer
    for (const text of [a, b]) {
      let el = text.parentElement
      while (el && el !== ca) {
        if (!joinsWord(el, win)) return false
        el = el.parentElement
      }
    }
    return true
  }

  // the nearest non-empty text node before/after `node` that continues the
  // same rendered run of text; null when a block boundary sits between
  function adjacentTextNode(node, dir) {
    const doc = node.ownerDocument
    const root = doc && (doc.body || doc.documentElement)
    if (!doc || !root) return null
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    walker.currentNode = node
    for (;;) {
      const n = dir === 'prev' ? walker.previousNode() : walker.nextNode()
      if (!n) return null
      if (!n.textContent) continue // zero-length nodes render nothing: skip
      return onlyInlineBetween(node, n, dir === 'prev') ? n : null
    }
  }

  // the character right after / before a boundary, read from the neighbouring
  // text node when the boundary sits on a node edge. A drag that starts on the
  // right half of a drop cap begins after its letter (<span>T|</span><small>wo),
  // so the first selected character lives in the next node
  function charAfter(node, offset) {
    const t = node.textContent || ''
    if (offset < t.length) return t[offset]
    const next = adjacentTextNode(node, 'next')
    return (next && next.textContent[0]) || ''
  }

  function charBefore(node, offset) {
    const t = node.textContent || ''
    if (offset > 0) return t[offset - 1]
    const prev = adjacentTextNode(node, 'prev')
    const pt = (prev && prev.textContent) || ''
    return pt[pt.length - 1] || ''
  }

  // grow a (possibly partial) range out to whole words on both ends, following
  // words across text-node boundaries. strict mode only completes an edge that
  // actually lands inside a word, so a selection ending on a space
  // ("care of the ") is left alone instead of swallowing the next word.
  function expandRangeToWords(range, strict) {
    const r = range.cloneRange()
    if (r.startContainer.nodeType === 3) {
      let node = r.startContainer
      let s = r.startOffset
      if (!strict || isWordChar(charAfter(node, s))) {
        for (;;) {
          const t = node.textContent || ''
          while (s > 0 && isWordChar(t[s - 1])) s--
          if (s > 0) break
          const prev = adjacentTextNode(node, 'prev')
          const pt = (prev && prev.textContent) || ''
          if (!prev || !isWordChar(pt[pt.length - 1])) break
          node = prev
          s = pt.length
        }
        try {
          r.setStart(node, s)
        } catch {}
      }
    }
    if (r.endContainer.nodeType === 3) {
      let node = r.endContainer
      let e = r.endOffset
      if (!strict || isWordChar(charBefore(node, e))) {
        for (;;) {
          const t = node.textContent || ''
          while (e < t.length && isWordChar(t[e])) e++
          if (e < t.length) break
          const next = adjacentTextNode(node, 'next')
          if (!next || !isWordChar((next.textContent || '')[0])) break
          node = next
          e = 0
        }
        try {
          r.setEnd(node, e)
        } catch {}
      }
    }
    return r
  }

  // select the whole word under a point
  function selectWordAtPoint(sel, x, y) {
    let caret = null
    if (document.caretRangeFromPoint) {
      caret = document.caretRangeFromPoint(x, y)
    } else if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y)
      if (p) {
        caret = document.createRange()
        caret.setStart(p.offsetNode, p.offset)
        caret.collapse(true)
      }
    }
    if (!caret) return false
    const word = expandRangeToWords(caret, false)
    if (word.collapsed || !word.toString().trim()) return false
    sel.removeAllRanges()
    sel.addRange(word)
    return true
  }

  // ---- UI root ----------------------------------------------------------------

  const FONT =
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans", sans-serif'

  const STYLE = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.box, .panel, .toast { font-family: ${FONT}; -webkit-font-smoothing: antialiased; }

.box {
  position: fixed; z-index: 2; width: fit-content; max-width: 500px;
  max-height: calc(100vh - 16px); overflow: auto; resize: both; cursor: move;
  padding: 6px 8px; border-radius: 8px; user-select: none; -webkit-user-select: none;
  background: rgba(255,255,255,0.97);
  box-shadow: 0 4px 24px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.05);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  transition: opacity 0.28s ease;
  --fg: #222; --dim: #999; --sep: rgba(0,0,0,0.07);
}
.box.dark {
  background: rgba(40,40,40,0.97);
  box-shadow: 0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);
  --fg: #ddd; --dim: #666; --sep: rgba(255,255,255,0.1);
}
.box::-webkit-resizer { display: none; }
.slot + .slot { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--sep); }
.label { font-size: 10px; line-height: 1; letter-spacing: 0.06em; color: var(--dim); margin-bottom: 3px; }
.text { font-size: 15px; line-height: 1.5; color: var(--fg); white-space: pre-wrap; }
.dim { color: var(--dim); }
.cover { position: fixed; inset: 0; z-index: 1; cursor: move; }

.toast {
  position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); z-index: 5;
  max-width: calc(100vw - 32px); padding: 8px 14px; border-radius: 8px;
  background: rgba(30,30,30,0.92); color: #fff; font-size: 13px; line-height: 1.5;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2); pointer-events: none; transition: opacity 0.25s;
}

.mask {
  position: fixed; inset: 0; z-index: 4; overflow: auto;
  background: rgba(0,0,0,0.32); padding: 6vh 16px 40px;
}
.panel {
  --bg: #fff; --fg: #1f1f1f; --muted: #777; --line: rgba(0,0,0,0.12);
  --field: #f5f4f1; --chip: #f1ede4; --accent: #d85a30; --ok: #2e7d32; --err: #c62828;
  max-width: 560px; margin: 0 auto; padding: 18px 20px 20px; border-radius: 12px;
  background: var(--bg); color: var(--fg); font-size: 13px; line-height: 1.5;
  box-shadow: 0 12px 48px rgba(0,0,0,0.25);
}
.panel.dark {
  --bg: #262624; --fg: #e8e6e1; --muted: #9a978f; --line: rgba(255,255,255,0.14);
  --field: #32312e; --chip: #3a3833; --ok: #81c784; --err: #ef9a9a;
}
.head { display: flex; align-items: flex-start; gap: 12px; }
.head h1 { margin: 0; font-size: 16px; font-weight: 600; }
.head .sub { margin-top: 2px; color: var(--muted); font-size: 12px; }
.head .close { margin-left: auto; }
.sec { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.sec > h2 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
.row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.row > .name { flex: 0 0 7.5em; }
.row > .grow { flex: 1 1 220px; min-width: 0; }
.check { display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer; }
.check input { width: 15px; height: 15px; margin: 0; accent-color: var(--accent); }
.hint { margin: -2px 0 8px; color: var(--muted); font-size: 11.5px; }
.err-text { color: var(--err); }
.status { color: var(--muted); font-size: 12px; }
.status.ok { color: var(--ok); }
.status.err { color: var(--err); }
.tag { margin-left: 8px; padding: 1px 8px; border-radius: 999px; background: var(--chip); color: var(--muted); font-size: 11px; }
.tag.on { background: var(--accent); color: #fff; }
.domains { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.chip { display: inline-flex; align-items: center; gap: 2px; padding: 2px 2px 2px 10px; border-radius: 999px; background: var(--chip); }
.chip button { padding: 0 7px; border: 0; background: transparent; color: var(--muted); font-size: 14px; line-height: 1.4; }
.presets { margin: 6px 0 0; padding: 10px 12px 4px; border-radius: 8px; border: 1px solid var(--line); }
input, select, textarea {
  font: inherit; color: inherit; background: var(--field); border: 1px solid var(--line);
  border-radius: 6px; padding: 5px 8px; outline: none; min-width: 0;
}
input:focus, select:focus, textarea:focus { border-color: var(--accent); }
textarea { display: block; width: 100%; min-height: 64px; margin: 4px 0 8px; resize: vertical; }
button {
  font: inherit; color: inherit; background: var(--field); border: 1px solid var(--line);
  border-radius: 6px; padding: 4px 10px; cursor: pointer;
}
button:hover:not(:disabled) { border-color: var(--muted); }
button:disabled { opacity: 0.45; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.kbd { min-width: 3.5rem; text-align: center; text-transform: uppercase; }
`

  let host = null
  let shadow = null
  let boxEl = null
  let toastEl = null
  let panelEl = null

  function el(tag, cls, ...kids) {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k)
    return n
  }

  // everything lives in one closed shadow root: page CSS can't leak in, and
  // only CSSOM writes are used (no style attributes / innerHTML), which a
  // strict page CSP or Trusted Types policy leaves alone
  function ensureUi() {
    if (host && host.isConnected) return
    host = document.createElement('flow-select')
    const hs = host.style
    hs.setProperty('all', 'initial', 'important')
    hs.setProperty('position', 'fixed', 'important')
    hs.setProperty('top', '0', 'important')
    hs.setProperty('left', '0', 'important')
    hs.setProperty('width', '0', 'important')
    hs.setProperty('height', '0', 'important')
    hs.setProperty('z-index', '2147483647', 'important')
    shadow = host.attachShadow({ mode: 'closed' })
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(STYLE)
      shadow.adoptedStyleSheets = [sheet]
    } catch {
      shadow.append(el('style', '', STYLE))
    }
    boxEl = null
    toastEl = null
    if (panelEl) {
      shadow.append(panelEl)
    }
    document.documentElement.append(host)
  }

  const inOwnUi = (e) => !!host && e.composedPath().includes(host)

  // true while the user is typing in a field (our settings panel included),
  // so the translate / pronounce keys must not fire
  function isTypingTarget() {
    let a = document.activeElement
    if (a && a === host) return true
    while (a && a.shadowRoot && a.shadowRoot.activeElement)
      a = a.shadowRoot.activeElement
    if (!a) return false
    const tag = a.tagName
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      !!a.isContentEditable
    )
  }

  function isDark() {
    if (prefs.theme === 'dark') return true
    if (prefs.theme === 'light') return false
    for (const n of [document.body, document.documentElement]) {
      if (!n) continue
      const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(n).backgroundColor)
      if (!m) continue
      const [r, g, b, a = 1] = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number)
      if (a < 0.5) continue
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110
    }
    return false
  }

  let toastTimer = null
  function toast(msg) {
    ensureUi()
    if (!toastEl) {
      toastEl = el('div', 'toast')
      shadow.append(toastEl)
    }
    toastEl.textContent = msg
    toastEl.style.opacity = '1'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.style.opacity = '0'
    }, 2600)
  }

  // ---- popup (ported from SelectionPopup.tsx) -------------------------------

  let popup = null // { text, x, y } while the box is up
  let results = [] // one slot per source: { source, text, done }
  let fading = false
  let pos = { left: 0, top: 0 }
  let reqId = 0
  // pronunciation ended before the translation landed; dismiss once it does
  let pendingDismiss = false
  let dismissTimer = null
  // when every translation slot finished (0 = not settled yet)
  let settledAt = 0
  let fadeTimer = null
  let dragging = false
  // the live selection, captured on mouseup but not shown until triggered
  let selection = null
  // the selected range and where it sat when `selection` was recorded, so
  // the box can follow the text when the page scrolls
  let anchor = null

  const viewW = () =>
    Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth)
  const viewH = () =>
    Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight)

  function placeBox() {
    if (!boxEl) return
    const s = boxEl.style
    s.left = `${pos.left}px`
    s.top = `${pos.top}px`
    s.minWidth = `${size.w}px`
    s.minHeight = size.h ? `${size.h}px` : ''
    s.opacity = fading ? '0' : '1'
    s.pointerEvents = fading ? 'none' : 'auto'
  }

  function renderBox() {
    if (!popup) {
      if (boxEl) boxEl.remove()
      boxEl = null
      return
    }
    ensureUi()
    if (!boxEl) {
      boxEl = el('div', 'box')
      boxEl.addEventListener('mousedown', onBoxMouseDown)
      shadow.append(boxEl)
    }
    boxEl.classList.toggle('dark', isDark())
    const multi = results.length > 1
    const llmLabel = activeLlmPreset(cfg).name || 'AI'
    boxEl.replaceChildren(
      ...results.map((r) => {
        const body = el('div', 'text')
        if (!r.done) body.append(el('span', 'dim', '...'))
        else if (r.text) body.append(r.text)
        else body.append(el('span', 'dim', '翻译失败，可按快捷键重试'))
        return el(
          'div',
          'slot',
          multi && el('div', 'label', r.source === 'google' ? 'Google' : llmLabel),
          body,
        )
      }),
    )
    placeBox()
  }

  // first placement: above the selection point, or at the offset the user
  // last dragged the box to
  function initialPos() {
    const offset = load('popupOffset', null)
    const w = Math.max(size.w, 200)
    const m = 8
    let left, top
    if (offset) {
      left = popup.x + offset.dx
      top = popup.y + offset.dy
    } else {
      left = popup.x - w / 2
      top = popup.y - 50
    }
    if (left < m) left = m
    if (left + w > viewW() - m) left = viewW() - w - m
    if (top < m) top = popup.y + 20
    if (top > viewH() - 60) top = viewH() - 60
    pos = { left, top }
  }

  // once the box has real dimensions (e.g. a long translation), pull it fully
  // back into the viewport; re-run as each async source result lands
  function fitIntoView() {
    if (!popup || !boxEl) return
    const m = 8
    const h = boxEl.offsetHeight
    const w = boxEl.offsetWidth
    let { left, top } = pos
    if (top + h > viewH() - m) top = viewH() - m - h
    if (left + w > viewW() - m) left = viewW() - w - m
    if (top < m) top = m
    if (left < m) left = m
    if (left !== pos.left || top !== pos.top) {
      pos = { left, top }
      placeBox()
    }
  }

  // move the recorded point (and return the delta) when the selected text
  // has scrolled since it was last measured
  function syncAnchor(sel) {
    if (!anchor || anchor.sel !== sel) return null
    const r = anchor.range.getBoundingClientRect()
    if (!r.width && !r.height) return null // range no longer rendered
    const dx = r.left - anchor.left
    const dy = r.top - anchor.top
    anchor.left = r.left
    anchor.top = r.top
    if (!dx && !dy) return null
    sel.x += dx
    sel.y += dy
    return { dx, dy }
  }

  function showPopup(sel) {
    clearTimeout(fadeTimer)
    fadeTimer = null
    fading = false
    syncAnchor(sel)
    const same = popup === sel
    popup = sel
    if (!same) initialPos()
    renderBox()
    fitIntoView()
  }

  function hidePopup() {
    popup = null
    fading = false
    renderBox()
  }

  function setResults(next) {
    results = next
    renderBox()
    fitIntoView()
    // when the last translation result lands: stamp the settle time, and if
    // the pronunciation already ended, close after a short reading grace
    const allDone = results.length > 0 && results.every((r) => r.done)
    if (!allDone) return
    if (!settledAt) settledAt = Date.now()
    if (pendingDismiss) {
      pendingDismiss = false
      scheduleDismiss(READ_GRACE)
    }
  }

  function clearSelection() {
    try {
      const s = window.getSelection()
      if (s) s.removeAllRanges()
    } catch {}
    selection = null
    anchor = null
  }

  // gently fade the box out, then drop it (and optionally the highlight)
  function dismiss(clearSel) {
    if (popup) {
      fading = true
      placeBox()
      clearTimeout(fadeTimer)
      fadeTimer = setTimeout(() => {
        fadeTimer = null
        hidePopup()
        if (clearSel) clearSelection()
      }, 280)
    } else if (clearSel) {
      clearSelection()
    }
  }

  function cancelPendingDismiss() {
    pendingDismiss = false
    clearTimeout(dismissTimer)
    dismissTimer = null
  }

  function scheduleDismiss(ms) {
    clearTimeout(dismissTimer)
    dismissTimer = setTimeout(() => {
      pendingDismiss = false
      dismiss(true)
    }, ms)
  }

  function translate(sel) {
    if (!cfg.translateEnabled) return
    cancelPendingDismiss()
    settledAt = 0
    const id = ++reqId
    const sources = activeSources(cfg)
    results = sources.map((s) => ({ source: s, text: '', done: false }))
    showPopup(sel)
    // fire all sources concurrently; each slot fills in as its result lands
    sources.forEach((src) => {
      translateText(sel.text, src).then((t) => {
        if (id !== reqId) return
        // show the model's output verbatim (no post-processing, so a custom
        // model / prompt keeps full control of formatting)
        setResults(
          results.map((r) => (r.source === src ? { ...r, text: t, done: true } : r)),
        )
      })
    })
  }

  function speak(sel) {
    if (!cfg.ttsEnabled) return
    // skip long selections so reading a sentence doesn't fire pronunciation
    const max = cfg.ttsMaxWords ?? 30
    if (max > 0 && sel.text.trim().split(/\s+/).length > max) return
    playTts(sel.text, () => {
      if (!(cfg.autoDismiss ?? true)) return
      // auto-close waits for whichever finishes last: if the translation is
      // still loading when the audio ends, defer until it settles
      const settled =
        !popup || results.length === 0 || results.every((r) => r.done)
      if (settled) {
        // no translation box → close right away
        if (!popup || results.length === 0) {
          dismiss(true)
          return
        }
        // keep the translation readable for READ_GRACE before closing
        const shown = Date.now() - (settledAt || Date.now())
        const wait = Math.max(0, READ_GRACE - shown)
        if (wait > 0) scheduleDismiss(wait)
        else dismiss(true)
        return
      }
      pendingDismiss = true
      // safety net so a hung translation can't hold the box forever
      clearTimeout(dismissTimer)
      dismissTimer = setTimeout(() => {
        if (pendingDismiss) {
          pendingDismiss = false
          dismiss(true)
        }
      }, 10000)
    })
  }

  // drop the box and everything in flight, but leave the page's selection
  function closeBox() {
    // drop in-flight translations and any deferred auto-close; stopAudio
    // also invalidates queued pronunciations
    reqId++
    cancelPendingDismiss()
    clearTimeout(fadeTimer)
    fadeTimer = null
    hidePopup()
    stopAudio()
  }

  // close the box and return to a clean state (no box, no highlight, no audio)
  function reset() {
    closeBox()
    clearSelection()
  }

  // same boundaries (0 = START_TO_START, 2 = END_TO_END)
  function sameRange(a, b) {
    try {
      return (
        a.compareBoundaryPoints(0, b) === 0 && a.compareBoundaryPoints(2, b) === 0
      )
    } catch {
      return false
    }
  }

  // record the current selection (snapped to whole words) and, when the
  // trigger mode says so, translate + pronounce it right away
  function capture(x, y, { allowClick = false, auto = cfg.autoOnSelect, skipSame = false } = {}) {
    const sel = window.getSelection()
    if (!sel) return
    let text = sel.toString().trim()
    if (!text && allowClick) {
      if (selectWordAtPoint(sel, x, y)) text = sel.toString().trim()
    } else if (text && (cfg.snapToWords ?? true) && sel.rangeCount) {
      const w = expandRangeToWords(sel.getRangeAt(0), true)
      const wt = w.toString().trim()
      if (wt && wt !== text) {
        try {
          sel.removeAllRanges()
          sel.addRange(w)
          text = wt
        } catch {}
      }
    }
    if (!text) return
    // a multi-line selection carries source line breaks and indentation;
    // collapse them so the model gets one clean paragraph. Soft hyphens and
    // zero-width marks are typography hints, not content
    const clean = text
      .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!clean) return
    if (skipSame && selection && selection.text === clean) return
    // the selection hasn't changed since the last capture (a click on the
    // selected text, letting go of a resize or a scrollbar): nothing new
    if (anchor && sel.rangeCount && sameRange(sel.getRangeAt(0), anchor.range))
      return
    // a box still fading out must not take the new selection down with it
    if (fadeTimer) {
      clearTimeout(fadeTimer)
      fadeTimer = null
      hidePopup()
    }
    const data = { text: clean, x, y }
    selection = data
    anchor = null
    if (sel.rangeCount) {
      const range = sel.getRangeAt(0).cloneRange()
      const r = range.getBoundingClientRect()
      anchor = { sel: data, range, left: r.left, top: r.top }
    }
    if (auto) {
      primeAudio()
      translate(data)
      speak(data)
    }
  }

  // ---- page events ------------------------------------------------------------

  const INTERACTIVE =
    'a, button, input, textarea, select, label, summary, [role="button"], [contenteditable]'

  function onMouseUp(e) {
    // Mac ctrl+click is a context click; it selects the word under the
    // pointer on its own, which must not count as a selection to translate
    if (e.button !== 0 || e.ctrlKey || inOwnUi(e) || isTypingTarget()) return
    const t = e.target
    const onInteractive = !!(t && t.closest && t.closest(INTERACTIVE))
    capture(e.clientX, e.clientY, {
      allowClick: !!cfg.clickSelectsWord && !onInteractive,
      // a tap has no keyboard to follow up with
      auto: cfg.autoOnSelect || lastPointer === 'touch',
    })
  }

  // a press on a scrollbar (the page's or an inner scroller's) is not a
  // press on the content
  function onScrollbar(e) {
    const t = e.target
    if (!t || t.nodeType !== 1) return false
    const de = document.documentElement
    if (t === de || t === document.body)
      return e.clientX >= de.clientWidth || e.clientY >= de.clientHeight
    return (
      (t.clientWidth > 0 && e.offsetX > t.clientWidth) ||
      (t.clientHeight > 0 && e.offsetY > t.clientHeight)
    )
  }

  function onMouseDown(e) {
    // right / middle button, Mac ctrl+click (context menu) and scrollbar
    // drags leave the box and the selection alone
    if (e.button !== 0 || e.ctrlKey || inOwnUi(e) || onScrollbar(e)) return
    // a press anywhere else closes the box. The selection itself stays the
    // page's (shift+click extends it, site toolbars still see it); if the
    // press cleared it, the check below forgets it like the reader does
    if (popup && !dragging) closeBox()
    setTimeout(() => {
      const s = window.getSelection()
      if (!s || !s.toString().trim()) {
        selection = null
        anchor = null
        closeBox()
      }
    }, 50)
  }

  let hoverTimer = null
  function onMouseMove(e) {
    if (!cfg.hoverSelectsWord) return
    // never fight a real drag selection
    if (e.buttons !== 0 || inOwnUi(e)) return
    clearTimeout(hoverTimer)
    const { clientX: x, clientY: y } = e
    hoverTimer = setTimeout(() => {
      if (isTypingTarget() || panelEl) return
      const s = window.getSelection()
      if (s && selectWordAtPoint(s, x, y)) capture(x, y, { skipSame: true })
    }, 120)
  }

  function onKeyDown(e) {
    if (panelEl) return
    if (e.key === 'Escape') {
      if (popup || currentStop) reset()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
    if (isTypingTarget()) return
    const sel = selection
    if (!sel) return
    const key = (e.key || '').toLowerCase()
    const hit =
      cfg.translateEnabled && key === cfg.translateShortcut
        ? 'translate'
        : cfg.ttsEnabled && key === cfg.ttsShortcut
          ? 'speak'
          : null
    if (!hit) return
    // the page must not see the key too (sites bind single letters)
    e.preventDefault()
    e.stopImmediatePropagation()
    primeAudio()
    if (hit === 'translate') translate(sel)
    else speak(sel)
  }

  let scrollRaf = 0
  function onScroll() {
    if (!popup || scrollRaf) return
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      if (!popup || dragging) return
      const d = syncAnchor(popup)
      if (!d) return
      pos = { left: pos.left + d.dx, top: pos.top + d.dy }
      placeBox()
    })
  }

  // touch screens: there is no mouseup after a long-press selection and no
  // keyboard for the shortcuts, so a settled selection triggers directly
  let lastPointer = 'mouse'
  let touchTimer = null
  function onPointerDown(e) {
    lastPointer = e.pointerType || 'mouse'
  }

  // lifting the finger off a selection is the last user gesture before the
  // (timer-driven) touch trigger: unlock audio here, or iOS stays silent
  function onTouchEnd() {
    const s = window.getSelection()
    if (s && !s.isCollapsed) primeAudio()
  }

  function onSelectionChange() {
    const s = window.getSelection()
    if (!s || s.isCollapsed) {
      clearTimeout(touchTimer)
      // iOS sends no mousedown for a tap on plain text; the tap only
      // collapses the selection, so that is the "tap outside"
      if (lastPointer === 'touch' && (popup || currentStop)) closeBox()
      // nothing left for the shortcuts (or the repeat check) to act on
      selection = null
      anchor = null
      return
    }
    if (lastPointer !== 'touch') return
    clearTimeout(touchTimer)
    touchTimer = setTimeout(() => {
      if (isTypingTarget() || panelEl) return
      const s = window.getSelection()
      if (!s || s.isCollapsed || !s.rangeCount) return
      const r = s.getRangeAt(0).getBoundingClientRect()
      if (!r.width && !r.height) return
      capture(r.left + r.width / 2, r.top, { auto: true, skipSame: true })
    }, 600)
  }

  function onBoxMouseDown(e) {
    if (e.button !== 0 || !boxEl) return
    const rect = boxEl.getBoundingClientRect()
    if (e.clientX > rect.right - 18 && e.clientY > rect.bottom - 18) {
      // the corner is the native resize handle: remember where it ends up
      const onResizeUp = () => {
        document.removeEventListener('mouseup', onResizeUp, true)
        if (!boxEl) return
        const r = boxEl.getBoundingClientRect()
        size = { w: Math.round(r.width), h: Math.round(r.height) }
        store('popupSize', size)
      }
      document.addEventListener('mouseup', onResizeUp, true)
      return
    }
    e.preventDefault()
    dragging = true
    const startX = e.clientX
    const startY = e.clientY
    const startLeft = pos.left
    const startTop = pos.top
    const cover = el('div', 'cover')
    shadow.append(cover)
    const onMove = (ev) => {
      ev.preventDefault()
      pos = {
        left: startLeft + (ev.clientX - startX),
        top: startTop + (ev.clientY - startY),
      }
      placeBox()
    }
    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', onUp, true)
      cover.remove()
      setTimeout(() => {
        dragging = false
      }, 0)
      if (popup) {
        store('popupOffset', {
          dx: startLeft + (ev.clientX - startX) - popup.x,
          dy: startTop + (ev.clientY - startY) - popup.y,
        })
      }
    }
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
  }

  let attached = false
  function attach() {
    if (attached) return
    attached = true
    window.addEventListener('mouseup', onMouseUp, true)
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('touchend', onTouchEnd, { capture: true, passive: true })
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    document.addEventListener('selectionchange', onSelectionChange)
    maybeAutoSync()
  }

  function detach() {
    if (!attached) return
    attached = false
    window.removeEventListener('mouseup', onMouseUp, true)
    window.removeEventListener('mousedown', onMouseDown, true)
    window.removeEventListener('mousemove', onMouseMove, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('touchend', onTouchEnd, { capture: true })
    window.removeEventListener('scroll', onScroll, { capture: true })
    document.removeEventListener('selectionchange', onSelectionChange)
    clearTimeout(hoverTimer)
    clearTimeout(touchTimer)
    reset()
  }

  function applyEnabled() {
    if (enabledHere()) attach()
    else detach()
    refreshMenus()
  }

  // ---- settings from Flow ---------------------------------------------------

  let syncBusy = false

  function setSyncInfo(ok, msg, updatedAt) {
    syncInfo = {
      at: Date.now(),
      ok,
      msg,
      updatedAt: updatedAt === undefined ? syncInfo.updatedAt : updatedAt,
    }
    store('flowSync', syncInfo)
    scheduleRender()
  }

  // pull Flow's synced settings (rides this browser's Flow login). Only
  // applies them when Flow changed since the last pull, unless forced.
  async function syncFromFlow(force) {
    const base = flowBase()
    if (!base) {
      setSyncInfo(false, '没填 Flow 地址')
      return false
    }
    syncBusy = true
    scheduleRender()
    const r = await gmRequest({
      method: 'GET',
      url: `${base}/api/sync/settings`,
      headers: { Accept: 'application/json' },
      timeout: PROXY_TIMEOUT,
    })
    syncBusy = false
    let snap = null
    if (r.ok && /json/.test(contentType(r.headers))) {
      try {
        snap = JSON.parse(r.text)
      } catch {}
    }
    if (!snap || typeof snap !== 'object') {
      setSyncInfo(
        false,
        r.status === 0
          ? '连不上 Flow'
          : r.status === 403
            ? '当前登录的 Flow 账号没有同步权限'
            : r.ok || r.status === 401 || r.status === 302
              ? '还没登录 Flow，先在这个浏览器里打开 Flow 登录一次'
              : `Flow 返回 HTTP ${r.status}`,
      )
      return false
    }
    const d = snap.data || {}
    if (!d.ttsConfig3) {
      setSyncInfo(false, 'Flow 里还没有保存过设置')
      return false
    }
    if (force || snap.updatedAt !== syncInfo.updatedAt) {
      cfg = { ...defaultCfg, ...d.ttsConfig3 }
      store('cfg', cfg)
      if (d.popupSize && d.popupSize.w) {
        size = { w: d.popupSize.w, h: d.popupSize.h || null }
        store('popupSize', size)
      }
      if (d.popupOffset) store('popupOffset', d.popupOffset)
    }
    setSyncInfo(true, '', snap.updatedAt)
    return true
  }

  async function maybeAutoSync() {
    if (!prefs.followFlow) return
    if (!firstRun && Date.now() - syncInfo.at < SYNC_EVERY) return
    const ok = await syncFromFlow(false)
    if (ok || !firstRun || load('cfg', null) !== null) return
    // remember the defaults so this warning shows only once
    store('cfg', cfg)
    toast('Flow 划词：没读到 Flow 的设置，翻译可能用不了。点油猴菜单里的「设置」看看')
  }

  // ---- settings panel ---------------------------------------------------------

  let renderQueued = false
  let renderForced = false
  // the text field a render is waiting on (see renderSettings)
  let renderWaitsFor = null
  // which shortcut is waiting for a key press
  let capturingKey = null
  let domainError = ''
  let domainDraft = ''
  const testState = { llm: '', tts: '' }

  // force: rebuild even under a focused text field (explicit actions only)
  function scheduleRender(force = false) {
    if (!panelEl) return
    if (force) renderForced = true
    if (renderQueued) return
    renderQueued = true
    // deferred so a field's change → blur → focus-next settles first
    setTimeout(renderSettings, 0)
  }

  const isTextField = (n) =>
    !!n &&
    (n.tagName === 'TEXTAREA' ||
      (n.tagName === 'INPUT' && !/^(checkbox|radio|button)$/.test(n.type)))

  function openSettings() {
    ensureUi()
    if (panelEl) return
    panelEl = el('div', 'mask')
    panelEl.addEventListener('mousedown', (e) => {
      if (e.target === panelEl) closeSettings()
    })
    // keep typing in our fields away from the page's own key handlers
    for (const type of ['keydown', 'keypress', 'keyup'])
      panelEl.addEventListener(type, (e) => e.stopPropagation())
    window.addEventListener('keydown', onSettingsKey, true)
    shadow.append(panelEl)
    renderSettings()
  }

  function closeSettings() {
    window.removeEventListener('keydown', onSettingsKey, true)
    capturingKey = null
    if (panelEl) panelEl.remove()
    panelEl = null
  }

  function onSettingsKey(e) {
    if (capturingKey) {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key !== 'Escape' && e.key.length === 1)
        updateCfg({ [capturingKey]: e.key.toLowerCase() })
      capturingKey = null
      scheduleRender()
      return
    }
    if (e.key === 'Escape') {
      e.stopImmediatePropagation()
      closeSettings()
    }
  }

  function updateCfg(patch, rerender = true) {
    cfg = { ...cfg, ...patch }
    store('cfg', cfg)
    if (rerender) scheduleRender()
  }

  function updatePrefs(patch, rerender = true) {
    prefs = { ...prefs, ...patch }
    store('prefs', prefs)
    if (rerender) scheduleRender()
  }

  // key: stable id so a rebuild can put focus back (defaults to the label)
  function button(text, onClick, cls, key = `btn:${text}`) {
    const b = el('button', cls, text)
    b.type = 'button'
    b.dataset.k = key
    b.addEventListener('click', onClick)
    return b
  }

  function checkbox(name, checked, onChange) {
    const input = el('input')
    input.type = 'checkbox'
    input.checked = !!checked
    input.dataset.k = `check:${name}`
    input.addEventListener('change', () => onChange(input.checked))
    return el('label', 'check', input, el('span', '', name))
  }

  function selectBox(options, value, onChange, key) {
    const s = el('select')
    s.dataset.k = key
    const list = options.some(([v]) => v === value)
      ? options
      : [...options, [value, value]]
    for (const [v, label] of list) {
      const o = el('option', '', label)
      o.value = v
      s.append(o)
    }
    s.value = value
    s.addEventListener('change', () => onChange(s.value))
    return s
  }

  function textField({ value, placeholder, type = 'text', key, onCommit, cls = 'grow' }) {
    const i = el('input', cls)
    i.type = type
    i.value = value == null ? '' : String(value)
    if (placeholder) i.placeholder = placeholder
    i.dataset.k = key
    i.spellcheck = false
    i.autocomplete = 'off'
    if (onCommit) i.addEventListener('change', () => onCommit(i.value, i))
    return i
  }

  const row = (name, ...controls) =>
    el('div', 'row', name === null ? null : el('span', 'name', name), ...controls)
  const hint = (text, cls = '') => el('div', `hint ${cls}`, text)
  const section = (title, ...kids) => el('section', 'sec', el('h2', '', title), ...kids)

  // "api.example.com" → "https://api.example.com/v1/…" (settings.tsx)
  function normalizeApiUrl(input, defaultPath) {
    let t = input.trim()
    if (!t) return t
    if (!/^https?:\/\//i.test(t)) t = `https://${t}`
    try {
      const u = new URL(t)
      if (u.pathname === '/' || u.pathname === '') {
        u.pathname = defaultPath
        return u.toString()
      }
    } catch {}
    return t
  }

  function renderSettings() {
    renderQueued = false
    if (!panelEl) return
    const a = shadow.activeElement
    // never rebuild under a field being typed in: its text only commits on
    // change (blur), so a rebuild now (a sync finishing, a test result, a
    // change from another tab) would throw it away. Rebuild once it's left.
    if (!renderForced && isTextField(a)) {
      if (renderWaitsFor !== a) {
        renderWaitsFor = a
        a.addEventListener(
          'blur',
          () => {
            renderWaitsFor = null
            scheduleRender()
          },
          { once: true },
        )
      }
      return
    }
    renderForced = false
    const focusKey = a && a.dataset ? a.dataset.k : ''
    const scroll = panelEl.scrollTop
    const panel = el(
      'div',
      `panel${isDark() ? ' dark' : ''}`,
      headerBlock(),
      sitesSection(),
      interactionSection(),
      translateSection(),
      ttsSection(),
      flowSection(),
    )
    panelEl.replaceChildren(panel)
    panelEl.scrollTop = scroll
    if (focusKey) {
      const f = panel.querySelector(`[data-k="${CSS.escape(focusKey)}"]`)
      if (f) f.focus()
    }
  }

  function headerBlock() {
    return el(
      'div',
      'head',
      el(
        'div',
        '',
        el('h1', '', 'Flow 划词'),
        el('div', 'sub', '选中网页上的英文，翻译、朗读，和 Flow 阅读器里一样'),
      ),
      button('关闭', closeSettings, 'close'),
    )
  }

  function sitesSection() {
    const on = enabledHere()
    const list = el('div', 'domains')
    if (!domains.length) list.append(el('span', 'status', '还没有网站'))
    for (const d of domains) {
      list.append(
        el(
          'span',
          'chip',
          d,
          button('×', () => setDomains(domains.filter((x) => x !== d)), '', `chip:${d}`),
        ),
      )
    }
    const input = textField({
      key: 'domain-add',
      value: domainError ? domainDraft : '',
      placeholder: '比如 ft.com，也可以直接粘贴网址',
    })
    const add = () => {
      const d = normalizeDomain(input.value, true)
      if (!d) {
        // keep what was typed so it can be fixed instead of retyped
        domainDraft = input.value
        domainError = input.value.trim() ? '这不像一个网址或域名' : ''
      } else {
        domainError = ''
        setDomains([...domains, d])
      }
      // the field still has focus, so ask for the rebuild explicitly
      scheduleRender(true)
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') add()
    })
    return section(
      '生效的网站',
      row(
        '当前网站',
        el('span', 'grow', currentHost(), el('span', on ? 'tag on' : 'tag', on ? '已启用' : '未启用')),
        button(on ? '在这里停用' : '在这里启用', toggleHere, on ? '' : 'primary', 'here'),
      ),
      list,
      row(null, input, button('添加', add)),
      domainError
        ? hint(domainError, 'err-text')
        : hint('填主域名就行，子域名一起生效，比如 economist.com 也包括 www.economist.com。改完已打开的页面立即生效。'),
    )
  }

  function shortcutButton(field) {
    const b = button(
      capturingKey === field ? '按一个键…' : String(cfg[field] || '').toUpperCase(),
      () => {
        capturingKey = field
        scheduleRender()
      },
      'kbd',
    )
    b.dataset.k = `kbd:${field}`
    return b
  }

  function interactionSection() {
    return section(
      '交互',
      row(
        '触发方式',
        selectBox(
          [
            ['shortcut', '快捷键'],
            ['select', '选中即触发'],
          ],
          cfg.autoOnSelect ? 'select' : 'shortcut',
          (v) => updateCfg({ autoOnSelect: v === 'select' }),
          'trigger',
        ),
      ),
      hint('手机上没有键盘，选中文字后总是直接翻译和朗读。'),
      row('翻译快捷键', shortcutButton('translateShortcut')),
      row('朗读快捷键', shortcutButton('ttsShortcut')),
      checkbox('自动补全选中的单词', cfg.snapToWords ?? true, (v) => updateCfg({ snapToWords: v })),
      checkbox('朗读结束后自动关闭翻译框', cfg.autoDismiss ?? true, (v) => updateCfg({ autoDismiss: v })),
      checkbox('点击选中单词', cfg.clickSelectsWord ?? false, (v) => updateCfg({ clickSelectsWord: v })),
      checkbox('悬停选中单词', cfg.hoverSelectsWord ?? false, (v) => updateCfg({ hoverSelectsWord: v })),
      row(
        '翻译框颜色',
        selectBox(
          [
            ['auto', '跟随网页'],
            ['light', '浅色'],
            ['dark', '深色'],
          ],
          prefs.theme,
          (v) => updatePrefs({ theme: v }),
          'theme',
        ),
      ),
    )
  }

  function translateSection() {
    const kids = [
      checkbox('启用翻译', cfg.translateEnabled, (v) => updateCfg({ translateEnabled: v })),
    ]
    if (cfg.translateEnabled) {
      const sources = activeSources(cfg)
      const toggle = (s) => {
        let next = sources.includes(s)
          ? sources.filter((x) => x !== s)
          : [...sources, s]
        // keep at least one source (re-render puts the tick back)
        if (!next.length) return scheduleRender()
        // stable display order: google above llm
        next = ['google', 'llm'].filter((x) => next.includes(x))
        updateCfg({
          translateSources: next,
          translateMethod: next.includes('llm') ? 'llm' : 'google',
        })
      }
      kids.push(
        el('div', 'status', '翻译来源（可多选）'),
        checkbox('Google（免费）', sources.includes('google'), () => toggle('google')),
        checkbox('AI 模型', sources.includes('llm'), () => toggle('llm')),
      )
      if (sources.includes('llm')) kids.push(presetManager('llm'))
    }
    return section('查词与翻译', ...kids)
  }

  function ttsSection() {
    const kids = [
      checkbox('启用发音', cfg.ttsEnabled, (v) => updateCfg({ ttsEnabled: v })),
    ]
    if (cfg.ttsEnabled) {
      const maxWords = textField({
        key: 'ttsMaxWords',
        type: 'number',
        cls: '',
        value: cfg.ttsMaxWords ?? 30,
        onCommit: (v) => updateCfg({ ttsMaxWords: Math.max(0, Number(v) || 0) }, false),
      })
      maxWords.min = '0'
      maxWords.style.width = '6em'
      kids.push(
        row(
          '音色',
          selectBox(VOICES.map((v) => [v, v]), cfg.voice, (v) => updateCfg({ voice: v }), 'voice'),
          el('span', '', '语速'),
          selectBox(
            SPEEDS.map((s) => [String(s), `${s}x`]),
            String(cfg.speed),
            (v) => updateCfg({ speed: Number(v) }),
            'speed',
          ),
        ),
        row('发音词数上限', maxWords),
        hint('0 = 不限制。超过该词数的选段不会朗读。'),
        presetManager('tts'),
      )
    }
    return section('朗读发音', ...kids)
  }

  // saved API endpoints, same model as Flow's PresetManager: the list plus the
  // active id, mirrored into the legacy single-config fields
  function presetManager(kind) {
    const llm = kind === 'llm'
    const listKey = llm ? 'llmPresets' : 'ttsPresets'
    const idKey = llm ? 'llmActiveId' : 'ttsActiveId'
    // Always read the live list: text fields commit without a rebuild, so a
    // list captured at render time would be stale by the second field and
    // each commit would undo the one before. Seeds from the legacy single
    // config on first use, like Flow.
    const livePresets = () => {
      if (cfg[listKey] && cfg[listKey].length) return cfg[listKey]
      const legacy = (llm ? cfg.llmApi : cfg.ttsApi) || { url: '', key: '' }
      return [
        {
          id: 'default',
          name: '默认',
          url: legacy.url,
          key: legacy.key,
          ...(llm ? {} : { model: cfg.ttsModel }),
        },
      ]
    }
    const liveActiveId = () => {
      const list = livePresets()
      return list.some((p) => p.id === cfg[idKey]) ? cfg[idKey] : list[0].id
    }
    const presets = livePresets()
    const activeId = liveActiveId()
    const active = presets.find((p) => p.id === activeId)

    const commit = (list, id, rerender = true) => {
      const a = list.find((p) => p.id === id) || list[0]
      const patch = { [listKey]: list, [idKey]: a && a.id }
      const api = { url: (a && a.url) || '', key: (a && a.key) || '' }
      if (llm) patch.llmApi = api
      else {
        patch.ttsApi = api
        if (a && a.model) patch.ttsModel = a.model
      }
      updateCfg(patch, rerender)
    }
    const patchActive = (p, rerender = false) => {
      const id = liveActiveId()
      commit(
        livePresets().map((x) => (x.id === id ? { ...x, ...p } : x)),
        id,
        rerender,
      )
    }

    const defaultPath = llm ? '/v1/chat/completions' : '/v1/audio/speech'
    const keyInput = textField({
      key: `${kind}.key`,
      type: 'password',
      value: active.key,
      placeholder: 'sk-…',
      onCommit: (v) => patchActive({ key: v.trim() }),
    })
    const eye = button(
      '显示',
      () => {
        keyInput.type = keyInput.type === 'password' ? 'text' : 'password'
        eye.textContent = keyInput.type === 'password' ? '显示' : '隐藏'
      },
      '',
      `${kind}.eye`,
    )
    const model = textField({
      key: `${kind}.model`,
      value: active.model || '',
      placeholder: llm ? 'gpt-4o-mini' : 'gpt-4o-mini-tts',
      onCommit: (v) => patchActive({ model: v.trim() }),
    })
    const listId = `fs-${kind}-models`
    model.setAttribute('list', listId)
    const datalist = el('datalist')
    datalist.id = listId
    for (const m of llm ? LLM_MODELS : TTS_MODELS) {
      const o = el('option')
      o.value = m
      datalist.append(o)
    }
    const del = button(
      '删除',
      () => {
        const id = liveActiveId()
        const rest = livePresets().filter((p) => p.id !== id)
        if (rest.length) commit(rest, rest[0].id)
      },
      '',
      `${kind}.del`,
    )
    del.disabled = presets.length <= 1

    const box = el(
      'div',
      'presets',
      row(
        '配置',
        selectBox(
          presets.map((p) => [p.id, p.name || '未命名']),
          activeId,
          (id) => commit(livePresets(), id),
          `${kind}.preset`,
        ),
        button(
          '新增',
          () => {
            const list = livePresets()
            const id = `p${Date.now().toString(36)}`
            commit([...list, { id, name: `配置 ${list.length + 1}`, url: '', key: '' }], id)
          },
          '',
          `${kind}.add`,
        ),
        del,
      ),
      row(
        '名称',
        textField({
          key: `${kind}.name`,
          value: active.name,
          onCommit: (v) => patchActive({ name: v.trim() }, true),
        }),
      ),
      row(
        'API 地址',
        textField({
          key: `${kind}.url`,
          value: active.url,
          placeholder: 'https://api.example.com',
          onCommit: (v, i) => {
            const n = normalizeApiUrl(v, defaultPath)
            i.value = n
            patchActive({ url: n })
          },
        }),
      ),
      hint(`只填域名会自动补全为 ${defaultPath}`),
      row('API 密钥', keyInput, eye),
      row('模型', model, datalist),
    )
    if (llm) {
      const prompt = el('textarea')
      prompt.rows = 3
      prompt.value = active.systemPrompt || ''
      prompt.placeholder = '留空使用内置提示词'
      prompt.dataset.k = 'llm.prompt'
      prompt.addEventListener('change', () => patchActive({ systemPrompt: prompt.value }))
      box.append(
        row(
          '思考强度',
          selectBox(
            [
              ['', '默认（跟随模型）'],
              ['off', '关闭思考'],
              ['minimal', 'minimal'],
              ['low', 'low'],
              ['medium', 'medium'],
              ['high', 'high'],
            ],
            active.reasoning || '',
            (v) => patchActive({ reasoning: v }, true),
            'llm.reasoning',
          ),
        ),
        hint('思考模型（DeepSeek V4 / GPT-5 系等）适用；模型不支持该参数时会翻译失败，改回默认即可'),
        el('div', '', '系统提示词'),
        prompt,
      )
    }
    const status = testState[kind]
    box.append(
      row(
        null,
        button('试一下', () => runTest(kind), '', `${kind}.test`),
        el('span', `status ${status.startsWith('成功') ? 'ok' : status.startsWith('失败') ? 'err' : ''}`, status),
      ),
      hint('地址和密钥留空时走 Flow 服务器的默认配置，需要这个浏览器登录过 Flow。'),
    )
    return box
  }

  async function runTest(kind) {
    if (kind === 'tts') primeAudio()
    testState[kind] = '请求中…'
    scheduleRender()
    if (kind === 'llm') {
      const t = await translateText('serendipity', 'llm')
      testState.llm = t
        ? `成功：${t.replace(/\s+/g, ' ').slice(0, 60)}`
        : '失败：检查地址、密钥和模型'
    } else {
      const buf = await fetchTtsAudio('Hello from Flow.')
      if (buf) {
        testState.tts = '成功，正在播放'
        stopAudio()
        const id = playSeq
        playBuffer(buf, id, () => {
          if (id === playSeq) currentStop = null
        })
      } else {
        testState.tts = '失败：检查地址、密钥和模型'
      }
    }
    scheduleRender()
  }

  function flowSection() {
    const s = syncInfo
    let text = '还没同步过'
    let cls = ''
    if (syncBusy) text = '同步中…'
    else if (s.at) {
      const when = new Date(s.at).toLocaleString('zh-CN', {
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      text = s.ok ? `${when} 同步成功` : `${when} 同步失败：${s.msg}`
      cls = s.ok ? 'ok' : 'err'
    }
    return section(
      '从 Flow 同步设置',
      row(
        'Flow 地址',
        textField({
          key: 'flowUrl',
          value: prefs.flowUrl,
          placeholder: 'https://flow.yangyichuan.com',
          onCommit: (v, i) => {
            let n = v.trim().replace(/\/+$/, '')
            if (n && !/^https?:\/\//i.test(n)) n = `https://${n}`
            i.value = n
            updatePrefs({ flowUrl: n }, false)
          },
        }),
      ),
      checkbox('跟随 Flow 的设置', prefs.followFlow, (v) => updatePrefs({ followFlow: v })),
      hint('开着时，打开网页会顺手看一眼 Flow 的设置（最多十分钟一次），Flow 里改过的会覆盖这里。想让网页和 Flow 用不同的设置就关掉。'),
      row(
        null,
        button(
          '立即同步',
          async () => {
            await syncFromFlow(true)
          },
          'primary',
        ),
        el('span', `status ${cls}`, text),
      ),
      hint('同步需要这个浏览器登录过 Flow。API 密钥只存在油猴的脚本存储里，网页本身读不到。'),
    )
  }

  // ---- start ------------------------------------------------------------------

  // another tab changed something: pick it up here too
  if (typeof GM_addValueChangeListener === 'function') {
    const watch = (key, apply) =>
      GM_addValueChangeListener(key, (_k, _old, value, remote) => {
        if (!remote) return
        apply(value)
        scheduleRender()
      })
    watch('domains', (v) => {
      domains = cleanDomains(v)
      applyEnabled()
    })
    watch('cfg', (v) => {
      cfg = { ...defaultCfg, ...(v || {}) }
    })
    watch('prefs', (v) => {
      prefs = { ...defaultPrefs, ...(v || {}) }
    })
    watch('popupSize', () => {
      size = loadSize()
    })
    watch('flowSync', (v) => {
      if (v) syncInfo = { ...syncInfo, ...v }
    })
  }

  applyEnabled()
})()
