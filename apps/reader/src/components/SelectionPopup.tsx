import { useEffect, useRef, useState } from 'react'
import { MdVolumeUp } from 'react-icons/md'
import { useSnapshot } from 'valtio'

import { BookTab } from '../models'
import { useColorScheme } from '../hooks'
import { useTtsConfig } from '../state'
import { playTts, translateText, stopAudio } from '../tts'

interface SelectionPopupProps {
  tab: BookTab
}

export const SelectionPopup: React.FC<SelectionPopupProps> = ({ tab }) => {
  const { iframe } = useSnapshot(tab)
  const { dark } = useColorScheme()
  const [ttsConfig] = useTtsConfig()
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const [translation, setTranslation] = useState('')
  const [loading, setLoading] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)
  const reqId = useRef(0)

  useEffect(() => {
    if (!iframe) return

    const onMouseUp = () => {
      const sel = iframe.getSelection()
      const text = sel?.toString().trim()
      if (!text) return
      setSelectedText(text)
    }

    const onMouseDown = () => {
      setTimeout(() => {
        const sel = iframe.getSelection()
        if (!sel?.toString().trim()) {
          setSelectedText(null)
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
    if (!selectedText || !ttsConfig.ttsEnabled) return
    playTts(selectedText, ttsConfig)
  }, [selectedText])

  useEffect(() => {
    if (!selectedText || !ttsConfig.translateEnabled) {
      setTranslation('')
      return
    }
    const id = ++reqId.current
    setLoading(true)
    setTranslation('')
    translateText(selectedText, ttsConfig).then((t) => {
      if (id === reqId.current) {
        setTranslation(t)
        setLoading(false)
      }
    })
  }, [selectedText])

  useEffect(() => {
    if (!selectedText) return
    const onClick = (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return
      setSelectedText(null)
      stopAudio()
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [selectedText])

  const showTranslation = ttsConfig.translateEnabled
  const showTts = ttsConfig.ttsEnabled && ttsConfig.ttsApi.url
  const active = showTranslation || showTts
  if (!selectedText || !active) return null
  if (!showTranslation) return null

  return (
    <div
      ref={popupRef}
      style={{
        position: 'absolute',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 320,
        maxWidth: 'calc(100% - 32px)',
        background: dark ? 'rgba(40,40,40,0.97)' : 'rgba(255,255,255,0.97)',
        borderRadius: 10,
        boxShadow: dark
          ? '0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)'
          : '0 4px 24px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.05)',
        padding: '10px 14px',
        backdropFilter: 'blur(8px)',
        zIndex: 50,
      }}
    >
      <div
        style={{
          fontSize: 15,
          lineHeight: 1.5,
          color: dark ? '#ddd' : '#222',
          whiteSpace: 'pre-wrap',
          textAlign: 'center',
        }}
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
            onClick={() => playTts(selectedText, ttsConfig)}
          >
            <MdVolumeUp size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
