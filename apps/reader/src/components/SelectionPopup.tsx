import { useEffect, useRef, useState } from 'react'
import { MdVolumeUp } from 'react-icons/md'
import { useSnapshot } from 'valtio'

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

export const SelectionPopup: React.FC<SelectionPopupProps> = ({ tab }) => {
  const { iframe } = useSnapshot(tab)
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

      setPopup({
        text,
        x: e.clientX + rect.left,
        y: e.clientY + rect.top,
      })
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

  const active = ttsConfig.ttsEnabled || ttsConfig.translateEnabled
  if (!popup || !active) return null

  const w = 300
  const margin = 8
  const h = popupRef.current?.offsetHeight || 60

  let left = popup.x - w / 2
  let top = popup.y - h - margin

  if (left < margin) left = margin
  if (left + w > window.innerWidth - margin)
    left = window.innerWidth - w - margin
  if (top < margin) top = popup.y + 20 + margin

  return (
    <div
      ref={popupRef}
      className="fixed z-50"
      style={{
        left,
        top,
        width: w,
        maxWidth: 'calc(100vw - 16px)',
        background: 'rgba(255,255,255,0.97)',
        borderRadius: 8,
        boxShadow: '0 2px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
        padding: '10px 14px',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            flex: 1,
            fontSize: 13,
            color: '#666',
            lineHeight: 1.3,
            wordBreak: 'break-word',
          }}
        >
          {popup.text.length > 80
            ? popup.text.slice(0, 80) + '...'
            : popup.text}
        </span>
        {ttsConfig.ttsEnabled && ttsConfig.ttsApi.url && (
          <button
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 2,
              color: '#555',
              flexShrink: 0,
            }}
            onClick={(e) => {
              e.stopPropagation()
              playTts(popup.text, ttsConfig)
            }}
          >
            <MdVolumeUp size={16} />
          </button>
        )}
      </div>
      {ttsConfig.translateEnabled && (
        <div
          style={{
            marginTop: 6,
            fontSize: 14,
            lineHeight: 1.5,
            color: '#222',
            whiteSpace: 'pre-wrap',
          }}
        >
          {loading ? (
            <span style={{ color: '#999' }}>...</span>
          ) : (
            translation
          )}
        </div>
      )}
    </div>
  )
}
