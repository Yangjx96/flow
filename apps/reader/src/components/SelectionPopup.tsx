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
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

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
      setPos(null)
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
      setPos({ left: ev.clientX - ox, top: ev.clientY - oy })
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const showTranslation = ttsConfig.translateEnabled
  const showTts = ttsConfig.ttsEnabled && ttsConfig.ttsApi.url
  const active = showTranslation || showTts
  if (!popup || !active) return null

  // If only TTS, no popup needed (audio plays automatically)
  if (!showTranslation) return null

  const w = 280
  const margin = 8
  let left = pos?.left ?? popup.x - w / 2
  let top = pos?.top ?? popup.y - 50

  if (!pos) {
    if (left < margin) left = margin
    if (left + w > window.innerWidth - margin) left = window.innerWidth - w - margin
    if (top < margin) top = popup.y + 20 + margin
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
        borderRadius: 8,
        boxShadow: dark
          ? '0 2px 16px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08)'
          : '0 2px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
        padding: '8px 12px',
        backdropFilter: 'blur(8px)',
        cursor: 'move',
        resize: 'horizontal',
        overflow: 'hidden',
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
        <button
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 0 0',
            color: dark ? '#aaa' : '#555',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => playTts(popup.text, ttsConfig)}
        >
          <MdVolumeUp size={14} />
        </button>
      )}
    </div>
  )
}
