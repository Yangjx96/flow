import { useCallback, useEffect, useRef, useState } from 'react'
import { MdVolumeUp } from 'react-icons/md'
import { useSnapshot } from 'valtio'

import { BookTab } from '../models'
import { useColorScheme } from '../hooks'
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

export const SelectionPopup: React.FC<SelectionPopupProps> = ({ tab }) => {
  const { iframe } = useSnapshot(tab)
  const { dark } = useColorScheme()
  const [ttsConfig] = useTtsConfig()
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [translation, setTranslation] = useState('')
  const [loading, setLoading] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)
  const reqId = useRef(0)

  useEffect(() => {
    if (!iframe) return

    const onMouseUp = (e: MouseEvent) => {
      const sel = iframe.getSelection()
      const text = sel?.toString().trim()
      if (!text) return
      const iframeEl = (iframe as any).frameElement as HTMLIFrameElement
      if (!iframeEl) return
      const rect = iframeEl.getBoundingClientRect()
      setPopup({ text, x: e.clientX + rect.left, y: e.clientY + rect.top })
    }

    const onMouseDown = () => {
      setTimeout(() => {
        const sel = iframe.getSelection()
        if (!sel?.toString().trim()) {
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
  }, [iframe])

  useEffect(() => {
    if (!popup?.text || !ttsConfig.ttsEnabled) return
    playTts(popup.text, ttsConfig)
  }, [popup?.text])

  useEffect(() => {
    if (!popup?.text || !ttsConfig.translateEnabled) {
      setTranslation('')
      return
    }
    const id = ++reqId.current
    setLoading(true)
    setTranslation('')
    translateText(popup.text, ttsConfig).then((t) => {
      if (id === reqId.current) {
        setTranslation(t)
        setLoading(false)
      }
    })
  }, [popup?.text])

  useEffect(() => {
    if (!popup) return
    const onClick = (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return
      setPopup(null)
      stopAudio()
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [popup])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const el = popupRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const ox = e.clientX - rect.left
    const oy = e.clientY - rect.top

    const onMove = (ev: MouseEvent) => {
      el.style.left = `${ev.clientX - ox}px`
      el.style.top = `${ev.clientY - oy}px`
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const r = el.getBoundingClientRect()
      try {
        localStorage.setItem('popupPos', JSON.stringify({ left: r.left, top: r.top }))
      } catch {}
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const showTranslation = ttsConfig.translateEnabled
  const showTts = ttsConfig.ttsEnabled && ttsConfig.ttsApi.url
  const active = showTranslation || showTts
  if (!popup || !active) return null
  if (!showTranslation) return null

  const w = 320
  const margin = 8
  let left: number, top: number

  let saved: { left: number; top: number } | null = null
  try {
    const s = localStorage.getItem('popupPos')
    if (s) saved = JSON.parse(s)
  } catch {}

  if (saved) {
    left = Math.max(margin, Math.min(saved.left, window.innerWidth - w - margin))
    top = Math.max(margin, Math.min(saved.top, window.innerHeight - 80))
  } else {
    left = popup.x - w / 2
    top = popup.y - 50
    if (left < margin) left = margin
    if (left + w > window.innerWidth - margin) left = window.innerWidth - w - margin
    if (top < margin) top = popup.y + 20
  }

  return (
    <div
      ref={popupRef}
      className="fixed z-50"
      style={{
        left,
        top,
        width: w,
        maxWidth: 'calc(100vw - 16px)',
        background: dark ? 'rgba(40,40,40,0.97)' : 'rgba(255,255,255,0.97)',
        borderRadius: 10,
        boxShadow: dark
          ? '0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)'
          : '0 4px 24px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.05)',
        padding: '10px 14px',
        backdropFilter: 'blur(8px)',
        cursor: 'move',
      }}
      onMouseDown={handleDragStart}
    >
      <div
        style={{
          fontSize: 15,
          lineHeight: 1.5,
          color: dark ? '#ddd' : '#222',
          whiteSpace: 'pre-wrap',
          cursor: 'text',
          userSelect: 'text',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {loading ? (
          <span style={{ color: dark ? '#666' : '#999' }}>...</span>
        ) : (
          translation
        )}
      </div>
      {showTts && (
        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <button
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 2,
              color: dark ? '#aaa' : '#555',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => playTts(popup.text, ttsConfig)}
          >
            <MdVolumeUp size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
