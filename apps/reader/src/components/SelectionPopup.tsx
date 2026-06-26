import { useCallback, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'

import { useColorScheme } from '../hooks'
import { BookTab } from '../models'
import { useTtsConfig } from '../state'
import { playTts, translateText, stopAudio } from '../tts'

interface PopupState {
  text: string
  x: number
  y: number
}

interface SelectionPopupProps {
  tab: BookTab
}

function loadOffset(): { dx: number; dy: number } | null {
  try {
    const s = localStorage.getItem('popupOffset')
    return s ? JSON.parse(s) : null
  } catch {
    return null
  }
}

function saveOffset(o: { dx: number; dy: number }) {
  try {
    localStorage.setItem('popupOffset', JSON.stringify(o))
  } catch {}
}

function loadSize(): { w: number; h: number } | null {
  try {
    const s = localStorage.getItem('popupSize')
    return s ? JSON.parse(s) : null
  } catch {
    return null
  }
}

function saveSize(o: { w: number; h: number }) {
  try {
    localStorage.setItem('popupSize', JSON.stringify(o))
  } catch {}
}

// don't hijack a keystroke while the user is typing in a field
function isTypingTarget() {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

export const SelectionPopup: React.FC<SelectionPopupProps> = ({ tab }) => {
  const { iframe } = useSnapshot(tab)
  const { dark } = useColorScheme()
  const [ttsConfig] = useTtsConfig()
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [translation, setTranslation] = useState('')
  const [loading, setLoading] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const [size, setSize] = useState<{ w: number; h: number | null }>(() => {
    const s = loadSize()
    return s ? { w: s.w, h: s.h } : { w: 60, h: null }
  })
  const popupRef = useRef<HTMLDivElement>(null)
  const reqId = useRef(0)
  const dragging = useRef(false)
  const popupData = useRef<PopupState | null>(null)
  const latestPos = useRef({ left: 0, top: 0 })
  // the live selection, captured on mouseup but not shown until triggered
  const selection = useRef<PopupState | null>(null)
  const cfg = useRef(ttsConfig)
  cfg.current = ttsConfig
  popupData.current = popup
  latestPos.current = pos

  useEffect(() => {
    if (!popup) return
    const offset = loadOffset()
    const w = Math.max(size.w, 200)
    const m = 8
    let left: number, top: number

    if (offset) {
      left = popup.x + offset.dx
      top = popup.y + offset.dy
    } else {
      left = popup.x - w / 2
      top = popup.y - 50
    }

    if (left < m) left = m
    if (left + w > window.innerWidth - m) left = window.innerWidth - w - m
    if (top < m) top = popup.y + 20
    if (top > window.innerHeight - 60) top = window.innerHeight - 60

    setPos({ left, top })
  }, [popup?.text, popup?.x, popup?.y])

  const translate = useCallback((sel: PopupState) => {
    if (!cfg.current.translateEnabled) return
    setPopup(sel)
    const id = ++reqId.current
    setLoading(true)
    setTranslation('')
    translateText(sel.text, cfg.current).then((t) => {
      if (id === reqId.current) {
        setTranslation(t)
        setLoading(false)
      }
    })
  }, [])

  const speak = useCallback((sel: PopupState) => {
    const c = cfg.current
    if (!c.ttsEnabled) return
    // skip long selections so reading a sentence doesn't fire pronunciation
    const max = c.ttsMaxWords ?? 30
    if (max > 0 && sel.text.trim().split(/\s+/).length > max) return
    playTts(sel.text, c)
  }, [])

  // capture selection; only auto-trigger when the user opted into it
  useEffect(() => {
    if (!iframe) return

    const onMouseUp = (e: MouseEvent) => {
      const sel = iframe.getSelection()
      const text = sel?.toString().trim()
      if (!text) return
      const iframeEl = (iframe as any).frameElement as HTMLIFrameElement
      if (!iframeEl) return
      const rect = iframeEl.getBoundingClientRect()
      const data = { text, x: e.clientX + rect.left, y: e.clientY + rect.top }
      selection.current = data
      if (cfg.current.autoOnSelect) {
        translate(data)
        speak(data)
      }
    }

    const onMouseDown = () => {
      setTimeout(() => {
        const sel = iframe.getSelection()
        if (!sel?.toString().trim()) {
          selection.current = null
          setPopup(null)
          stopAudio()
        }
      }, 50)
    }

    iframe.addEventListener('mouseup', onMouseUp)
    iframe.addEventListener('mousedown', onMouseDown)
    return () => {
      iframe.removeEventListener('mouseup', onMouseUp)
      iframe.removeEventListener('mousedown', onMouseDown)
    }
  }, [iframe, translate, speak])

  // keyboard shortcuts: translate / pronounce the current selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget()) return
      const sel = selection.current
      if (!sel) return
      const key = e.key.toLowerCase()
      const c = cfg.current
      if (c.translateEnabled && key === c.translateShortcut) {
        e.preventDefault()
        translate(sel)
      } else if (c.ttsEnabled && key === c.ttsShortcut) {
        e.preventDefault()
        speak(sel)
      }
    }

    document.addEventListener('keydown', onKey)
    iframe?.addEventListener('keydown', onKey as any)
    return () => {
      document.removeEventListener('keydown', onKey)
      iframe?.removeEventListener('keydown', onKey as any)
    }
  }, [iframe, translate, speak])

  useEffect(() => {
    if (!popup) return
    const onClick = (e: MouseEvent) => {
      if (dragging.current) return
      if (popupRef.current?.contains(e.target as Node)) return
      setPopup(null)
      stopAudio()
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [popup])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    const el = popupRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      if (e.clientX > rect.right - 18 && e.clientY > rect.bottom - 18) {
        const onResizeUp = () => {
          document.removeEventListener('mouseup', onResizeUp)
          if (popupRef.current) {
            const r = popupRef.current.getBoundingClientRect()
            const ns = { w: Math.round(r.width), h: Math.round(r.height) }
            setSize(ns)
            saveSize(ns)
          }
        }
        document.addEventListener('mouseup', onResizeUp)
        return
      }
    }
    e.preventDefault()
    dragging.current = true
    const startX = e.clientX
    const startY = e.clientY
    const startLeft = latestPos.current.left
    const startTop = latestPos.current.top

    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:49;cursor:move'
    document.body.appendChild(overlay)

    const onMove = (ev: MouseEvent) => {
      ev.preventDefault()
      setPos({
        left: startLeft + (ev.clientX - startX),
        top: startTop + (ev.clientY - startY),
      })
    }
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      overlay.remove()
      setTimeout(() => {
        dragging.current = false
      }, 0)
      const finalLeft = startLeft + (ev.clientX - startX)
      const finalTop = startTop + (ev.clientY - startY)
      const p = popupData.current
      if (p) {
        saveOffset({ dx: finalLeft - p.x, dy: finalTop - p.y })
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  if (!popup) return null

  return (
    <>
      <style>{`.sp-box::-webkit-resizer{display:none}`}</style>
      <div
        ref={popupRef}
        className="sp-box fixed z-50"
        style={{
          left: pos.left,
          top: pos.top,
          width: 'fit-content',
          minWidth: size.w,
          maxWidth: 500,
          ...(size.h ? { minHeight: size.h } : {}),
          background: dark ? 'rgba(40,40,40,0.97)' : 'rgba(255,255,255,0.97)',
          borderRadius: 8,
          boxShadow: dark
            ? '0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)'
            : '0 4px 24px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.05)',
          backdropFilter: 'blur(8px)',
          overflow: 'auto',
          resize: 'both',
          cursor: 'move',
          padding: '6px 8px',
        }}
        onMouseDown={handleDragStart}
      >
        <div
          style={{
            fontSize: 15,
            lineHeight: 1.5,
            color: dark ? '#ddd' : '#222',
            whiteSpace: 'pre-wrap',
          }}
        >
          {loading ? (
            <span style={{ color: dark ? '#666' : '#999' }}>...</span>
          ) : (
            translation
          )}
        </div>
      </div>
    </>
  )
}
