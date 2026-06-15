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

  // auto-play TTS
  useEffect(() => {
    if (!popup?.text || !ttsConfig.enabled) return
    playTts(popup.text, ttsConfig)
  }, [popup?.text])

  // auto-translate
  useEffect(() => {
    if (!popup?.text || !ttsConfig.translateEnabled || !ttsConfig.enabled) {
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

  // dismiss on outside click
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

  if (!popup || !ttsConfig.enabled) return null

  const w = 280
  const margin = 8
  const h = popupRef.current?.offsetHeight || 80

  let left = popup.x - w / 2
  let top = popup.y - h - margin

  if (left < margin) left = margin
  if (left + w > window.innerWidth - margin)
    left = window.innerWidth - w - margin
  if (top < margin) top = popup.y + 20 + margin

  return (
    <div
      ref={popupRef}
      className="bg-surface text-on-surface shadow-1 fixed z-50 rounded-lg border border-outline-variant/20 p-3"
      style={{ left, top, width: w, maxWidth: 'calc(100vw - 16px)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="typescale-body-small text-outline break-all leading-snug">
          {popup.text}
        </span>
        <button
          className="text-primary shrink-0 rounded p-0.5 hover:opacity-70"
          onClick={(e) => {
            e.stopPropagation()
            playTts(popup.text, ttsConfig)
          }}
        >
          <MdVolumeUp size={18} />
        </button>
      </div>
      {(loading || translation) && (
        <div className="typescale-body-medium text-on-surface mt-2 whitespace-pre-wrap leading-relaxed">
          {loading ? (
            <span className="text-outline animate-pulse">...</span>
          ) : (
            translation
          )}
        </div>
      )}
    </div>
  )
}
