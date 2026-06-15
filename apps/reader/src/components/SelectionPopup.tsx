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

export const SelectionPopup: React.FC<SelectionPopupProps> = ({ tab }) => {
  const { iframe } = useSnapshot(tab)
  const { dark } = useColorScheme()
  const [ttsConfig] = useTtsConfig()
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [translation, setTranslation] = useState('')
  const [loading, setLoading] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const popupRef = useRef<HTMLDivElement>(null)
  const reqId = useRef(0)
  const dragging = useRef(false)
  const popupData = useRef<PopupState | null>(null)
  const latestPos = useRef({ left: 0, top: 0 })
  popupData.current = popup
  latestPos.current = pos

  useEffect(() => {
    if (!popup) return
    const offset = loadOffset()
    const w = 320
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
      if (dragging.current) return
      if (popupRef.current?.contains(e.target as Node)) return
      setPopup(null)
      stopAudio()
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [popup])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = true
    const startX = e.clientX
    const startY = e.clientY
    const startLeft = latestPos.current.left
    const startTop = latestPos.current.top

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

  const showTranslation = ttsConfig.translateEnabled
  const showTts = ttsConfig.ttsEnabled && ttsConfig.ttsApi.url
  const active = showTranslation || showTts
  if (!popup || !active) return null
  if (!showTranslation) return null

  return (
    <>
      <style>{`.sp-box::-webkit-resizer{display:none}`}</style>
      <div
        ref={popupRef}
        className="sp-box fixed z-50"
        style={{
          left: pos.left,
          top: pos.top,
          minWidth: 120,
          width: 280,
          background: dark ? 'rgba(40,40,40,0.97)' : 'rgba(255,255,255,0.97)',
          borderRadius: 8,
          boxShadow: dark
            ? '0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)'
            : '0 4px 24px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.05)',
          backdropFilter: 'blur(8px)',
          overflow: 'auto',
          resize: 'both',
        }}
      >
        <div
          style={{ padding: '6px 8px 0', cursor: 'move' }}
          onMouseDown={handleDragStart}
        />
        <div
          style={{
            padding: '2px 8px 6px',
            fontSize: 15,
            lineHeight: 1.5,
            color: dark ? '#ddd' : '#222',
            whiteSpace: 'pre-wrap',
            cursor: 'text',
            userSelect: 'text',
          }}
        >
          {loading ? (
            <span style={{ color: dark ? '#666' : '#999' }}>...</span>
          ) : (
            translation
          )}
        </div>
        {showTts && (
          <div style={{ textAlign: 'center', paddingBottom: 4 }}>
            <button
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 2,
                color: dark ? '#aaa' : '#555',
              }}
              onClick={() => playTts(popup.text, ttsConfig)}
            >
              <MdVolumeUp size={14} />
            </button>
          </div>
        )}
      </div>
    </>
  )
}
