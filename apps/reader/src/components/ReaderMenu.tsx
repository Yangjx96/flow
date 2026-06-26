import { Overlay } from '@literal-ui/core'
import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { IconType } from 'react-icons'
import { MdClose, MdToc } from 'react-icons/md'
import { RiFontSize, RiSettings5Line } from 'react-icons/ri'

import { useTranslation } from '../hooks'

import { Settings } from './pages'
import { TocView } from './viewlets/TocView'
import { TypographyView } from './viewlets/TypographyView'

type Panel = 'typography' | 'toc' | 'settings'

// only reveal the launcher when the cursor reaches the far-right blank margin
const EDGE = 96

export const ReaderMenu: React.FC = () => {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [nearEdge, setNearEdge] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const t = useTranslation()

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (e.clientX > window.innerWidth - EDGE) {
        if (hideTimer.current) {
          clearTimeout(hideTimer.current)
          hideTimer.current = null
        }
        setNearEdge(true)
      } else if (!hideTimer.current) {
        hideTimer.current = setTimeout(() => {
          setNearEdge(false)
          hideTimer.current = null
        }, 500)
      }
    }
    document.addEventListener('mousemove', onMove)
    return () => {
      document.removeEventListener('mousemove', onMove)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel])

  const items: { key: Panel; Icon: IconType; title: string }[] = [
    { key: 'typography', Icon: RiFontSize, title: t('typography.title') },
    { key: 'toc', Icon: MdToc, title: t('toc.title') },
    { key: 'settings', Icon: RiSettings5Line, title: t('settings.title') },
  ]

  return (
    <>
      <div
        className={clsx(
          'ReaderMenu bg-surface/70 fixed right-2 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-0.5 rounded-full p-1 backdrop-blur transition-opacity duration-300',
          panel || !nearEdge ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
        style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}
      >
        {items.map(({ key, Icon, title }) => (
          <button
            key={key}
            title={title}
            aria-label={title}
            onClick={() => setPanel(key)}
            className="text-outline/70 hover:text-on-surface-variant flex h-9 w-9 items-center justify-center rounded-full"
          >
            <Icon size={20} />
          </button>
        ))}
      </div>

      {panel && (
        <>
          <Overlay className="z-40 !bg-black/20" onClick={() => setPanel(null)} />
          <div className="ReaderDrawer bg-surface fixed inset-y-0 right-0 z-50 flex w-[340px] max-w-[85vw] flex-col shadow-2xl">
            <div className="flex h-10 shrink-0 items-center justify-end px-2">
              <button
                title={t('action.close')}
                aria-label={t('action.close')}
                onClick={() => setPanel(null)}
                className="text-outline hover:text-on-surface p-1"
              >
                <MdClose size={18} />
              </button>
            </div>
            <div className="scroll min-h-0 flex-1 overflow-y-auto">
              {panel === 'typography' && (
                <TypographyView
                  name={t('typography.title')}
                  title={t('typography.title')}
                />
              )}
              {panel === 'toc' && (
                <TocView name={t('toc.title')} title={t('toc.title')} />
              )}
              {panel === 'settings' && <Settings />}
            </div>
          </div>
        </>
      )}
    </>
  )
}
