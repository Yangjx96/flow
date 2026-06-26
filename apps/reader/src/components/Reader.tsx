import { useEventListener } from '@literal-ui/hooks'
import clsx from 'clsx'
import React, {
  ComponentProps,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { MdChevronRight, MdClose, MdWebAsset } from 'react-icons/md'
import { RiBookLine } from 'react-icons/ri'
import { PhotoSlider } from 'react-photo-view'
import { useSetRecoilState } from 'recoil'
import { useSnapshot } from 'valtio'

import { RenditionSpread } from '@flow/epubjs/types/rendition'
import { navbarState } from '@flow/reader/state'

import { db } from '../db'
import { handleFiles } from '../file'
import {
  hasSelection,
  useBackground,
  useColorScheme,
  useDisablePinchZooming,
  useMobile,
  useSync,
  useTranslation,
  useTypography,
} from '../hooks'
import { BookTab, reader, useReaderSnapshot } from '../models'
import { isTouchScreen } from '../platform'
import { updateCustomStyle } from '../styles'

import {
  getClickedAnnotation,
  setClickedAnnotation,
  Annotations,
} from './Annotation'
import { ReaderMenu } from './ReaderMenu'
import { SelectionPopup } from './SelectionPopup'
import { Tab } from './Tab'
import { DropZone, SplitView, useDndContext, useSplitViewItem } from './base'
import * as pages from './pages'

function handleKeyDown(tab?: BookTab) {
  return (e: KeyboardEvent) => {
    try {
      switch (e.code) {
        case 'ArrowLeft':
        case 'ArrowUp':
          tab?.prev()
          break
        case 'ArrowRight':
        case 'ArrowDown':
          tab?.next()
          break
        case 'Space':
          e.shiftKey ? tab?.prev() : tab?.next()
      }
    } catch (error) {
      // ignore `rendition is undefined` error
    }
  }
}

export function ReaderGridView() {
  const { groups } = useReaderSnapshot()

  useEventListener('keydown', handleKeyDown(reader.focusedBookTab))

  if (!groups.length) return null
  return (
    <SplitView className={clsx('ReaderGridView')}>
      {groups.map(({ id }, i) => (
        <ReaderGroup key={id} index={i} />
      ))}
    </SplitView>
  )
}

interface ReaderGroupProps {
  index: number
}
function ReaderGroup({ index }: ReaderGroupProps) {
  const group = reader.groups[index]!
  const { focusedIndex } = useReaderSnapshot()
  const { tabs, selectedIndex } = useSnapshot(group)
  const t = useTranslation()

  const { size } = useSplitViewItem(`${ReaderGroup.name}.${index}`, {
    visible: false,
  })

  const handleMouseDown = useCallback(() => {
    reader.selectGroup(index)
  }, [index])

  const r = useReaderSnapshot()
  const readMode = r.focusedTab?.isBook

  return (
    <div
      className="ReaderGroup flex flex-1 flex-col overflow-hidden focus:outline-none"
      onMouseDown={handleMouseDown}
      style={{ width: size }}
    >
      {!readMode && (
        <Tab.List
          className="hidden sm:flex"
          onDelete={() => reader.removeGroup(index)}
        >
          {tabs.map((tab, i) => {
            const selected = i === selectedIndex
            const focused = index === focusedIndex && selected
            return (
              <Tab
                key={tab.id}
                selected={selected}
                focused={focused}
                onClick={() => group.selectTab(i)}
                onDelete={() => reader.removeTab(i, index)}
                Icon={tab instanceof BookTab ? RiBookLine : MdWebAsset}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', `${index},${i}`)
                }}
              >
                {tab.isBook ? tab.title : t(`${tab.title}.title`)}
              </Tab>
            )
          })}
        </Tab.List>
      )}

      <DropZone
        className={clsx('flex-1', isTouchScreen || 'h-0')}
        split
        onDrop={async (e, position) => {
          const files = e.dataTransfer.files
          let tabs = []

          if (files.length) {
            tabs = await handleFiles(files)
          } else {
            const text = e.dataTransfer.getData('text/plain')
            const fromTab = text.includes(',')

            if (fromTab) {
              const indexes = text.split(',')
              const groupIdx = Number(indexes[0])

              if (index === groupIdx) {
                if (group.tabs.length === 1) return
                if (position === 'universe') return
              }

              const tabIdx = Number(indexes[1])
              const tab = reader.removeTab(tabIdx, groupIdx)
              if (tab) tabs.push(tab)
            } else {
              const id = text
              const tabParam =
                Object.values(pages).find((p) => p.displayName === id) ??
                (await db?.books.get(id))
              if (tabParam) tabs.push(tabParam)
            }
          }

          if (tabs.length) {
            switch (position) {
              case 'left':
                reader.addGroup(tabs, index)
                break
              case 'right':
                reader.addGroup(tabs, index + 1)
                break
              default:
                tabs.forEach((t) => reader.addTab(t, index))
            }
          }
        }}
      >
        {group.tabs.map((tab, i) => (
          <PaneContainer active={i === selectedIndex} key={tab.id}>
            {tab instanceof BookTab ? (
              <BookPane tab={tab} onMouseDown={handleMouseDown} />
            ) : (
              <tab.Component />
            )}
          </PaneContainer>
        ))}
      </DropZone>
    </div>
  )
}

interface PaneContainerProps {
  active: boolean
}
const PaneContainer: React.FC<PaneContainerProps> = ({ active, children }) => {
  return <div className={clsx('h-full', active || 'hidden')}>{children}</div>
}

interface BookPaneProps {
  tab: BookTab
  onMouseDown: () => void
}

function useAutoHide(iframe: any) {
  const [visible, setVisible] = useState(false)
  const timer = useRef<any>(null)

  const show = useCallback(() => {
    setVisible(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(false), 2500)
  }, [])

  useEffect(() => {
    const onMove = () => show()
    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [show])

  useEffect(() => {
    if (!iframe) return
    const onMove = () => show()
    iframe.addEventListener('mousemove', onMove)
    return () => iframe.removeEventListener('mousemove', onMove)
  }, [iframe, show])

  return visible
}

function BookPane({ tab, onMouseDown }: BookPaneProps) {
  const ref = useRef<HTMLDivElement>(null)
  const prevSize = useRef(0)
  const typography = useTypography(tab)
  const { dark } = useColorScheme()
  const [background] = useBackground()

  const { iframe, rendition, rendered, container, book } = useSnapshot(tab)
  const chromeVisible = useAutoHide(iframe)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new ResizeObserver(([e]) => {
      const size = e?.contentRect.width ?? 0
      if (size !== 0 && prevSize.current !== 0) {
        reader.resize()
      }
      prevSize.current = size
    })

    observer.observe(el)

    return () => {
      observer.disconnect()
    }
  }, [])

  useSync(tab)

  const setNavbar = useSetRecoilState(navbarState)
  const mobile = useMobile()

  const applyCustomStyle = useCallback(() => {
    const contents = rendition?.getContents()[0]
    updateCustomStyle(contents, typography)
  }, [rendition, typography])

  useEffect(() => {
    tab.onRender = applyCustomStyle
  }, [applyCustomStyle, tab])

  useEffect(() => {
    if (ref.current) tab.render(ref.current)
  }, [tab])

  useEffect(() => {
    rendition?.spread(typography.spread ?? RenditionSpread.Auto)
  }, [typography.spread, rendition])

  useEffect(() => applyCustomStyle(), [applyCustomStyle])

  useEffect(() => {
    if (dark === undefined) return
    rendition?.themes.override('color', dark ? '#bfc8ca' : '#3f484a', dark)
  }, [rendition, dark])

  const [src, setSrc] = useState<string>()

  useEffect(() => {
    if (src) {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement?.blur()
    }
  }, [src])

  const { setDragEvent } = useDndContext()

  useEventListener(iframe, 'dragover', (e: any) => {
    setDragEvent(e)
  })

  useEventListener(iframe, 'mousedown', onMouseDown)

  useEventListener(iframe, 'click', (e) => {
    e.preventDefault()

    for (const el of e.composedPath() as any) {
      if (el.tagName === 'A' && el.href) {
        tab.showPrevLocation()
        return
      }
      if (
        mobile === false &&
        el.tagName === 'IMG' &&
        el.src.startsWith('blob:')
      ) {
        setSrc(el.src)
        return
      }
    }

    if (isTouchScreen && container) {
      if (getClickedAnnotation()) {
        setClickedAnnotation(false)
        return
      }

      const w = container.clientWidth
      const x = e.clientX % w
      const threshold = 0.3
      const side = w * threshold

      if (x < side) {
        tab.prev()
      } else if (w - x < side) {
        tab.next()
      } else if (mobile) {
        setNavbar((a) => !a)
      }
    }
  })

  useEventListener(iframe, 'wheel', (e) => {
    if (e.deltaY < 0) {
      tab.prev()
    } else {
      tab.next()
    }
  })

  useEventListener(iframe, 'keydown', handleKeyDown(tab))

  useEventListener(iframe, 'touchstart', (e) => {
    const x0 = e.targetTouches[0]?.clientX ?? 0
    const y0 = e.targetTouches[0]?.clientY ?? 0
    const t0 = Date.now()

    if (!iframe) return

    iframe.ontouchend = function handleTouchEnd(e: TouchEvent) {
      iframe.ontouchend = undefined
      const selection = iframe.getSelection()
      if (hasSelection(selection)) return

      const x1 = e.changedTouches[0]?.clientX ?? 0
      const y1 = e.changedTouches[0]?.clientY ?? 0
      const t1 = Date.now()

      const deltaX = x1 - x0
      const deltaY = y1 - y0
      const deltaT = t1 - t0

      const absX = Math.abs(deltaX)
      const absY = Math.abs(deltaY)

      if (absX < 10) return

      if (absY / absX > 2) {
        if (deltaT > 100 || absX < 30) {
          return
        }
      }

      if (deltaX > 0) {
        tab.prev()
      }

      if (deltaX < 0) {
        tab.next()
      }
    }
  })

  useDisablePinchZooming(iframe)

  const percentage = (book.percentage ?? 0) * 100

  return (
    <div className={clsx('flex h-full flex-col', mobile && 'py-[3vw]')}>
      <PhotoSlider
        images={[{ src, key: 0 }]}
        visible={!!src}
        onClose={() => setSrc(undefined)}
        maskOpacity={0.6}
        bannerVisible={false}
      />
      <ReaderPaneHeader tab={tab} visible={chromeVisible} />
      <div
        ref={ref}
        className={clsx('relative flex-1', isTouchScreen || 'h-0')}
        style={{
          colorScheme: 'auto',
          maxWidth: typography.maxWidth ?? 800,
          marginInline: 'auto',
          width: '100%',
        }}
      >
        <div
          className={clsx(
            'absolute inset-0',
            'z-20',
            (rendered || iframe) && 'hidden',
            background,
          )}
        />
        <SelectionPopup tab={tab} />
        <Annotations tab={tab} />
      </div>
      <ReaderPaneFooter tab={tab} />
      <KindleProgress tab={tab} />
      <ProgressBar percentage={percentage} />
      <ReaderMenu visible={chromeVisible} />
    </div>
  )
}

interface ReaderPaneHeaderProps {
  tab: BookTab
  visible: boolean
}
const ReaderPaneHeader: React.FC<ReaderPaneHeaderProps> = ({
  tab,
  visible,
}) => {
  const { location } = useSnapshot(tab)
  const navPath = tab.getNavPath()

  useEffect(() => {
    navPath.forEach((i) => (i.expanded = true))
  }, [navPath])

  return (
    <div
      style={{
        transition: 'opacity 0.3s',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <Bar>
        <div className="scroll-h flex items-center gap-1">
          <button
            className="text-outline hover:text-on-surface mr-1 flex-shrink-0"
            onClick={() => reader.clear()}
            title="Close book"
          >
            <MdClose size={16} />
          </button>
          {navPath.map((item, i) => (
            <button
              key={i}
              className="hover:text-on-surface flex shrink-0 items-center"
            >
              {item.label}
              {i !== navPath.length - 1 && <MdChevronRight size={16} />}
            </button>
          ))}
        </div>
        {location && (
          <div className="shrink-0">
            {location.start.displayed.page} / {location.start.displayed.total}
          </div>
        )}
      </Bar>
    </div>
  )
}

interface FooterProps {
  tab: BookTab
}
const ReaderPaneFooter: React.FC<FooterProps> = ({ tab }) => {
  const { locationToReturn } = useSnapshot(tab)

  if (!locationToReturn) return null

  const returnLabel = tab.mapSectionToNavItem(locationToReturn.end.href)?.label

  return (
    <Bar>
      <button
        onClick={() => {
          tab.hidePrevLocation()
          tab.display(locationToReturn.end.cfi, false)
        }}
      >
        Return to {returnLabel || 'previous location'}
      </button>
      <button onClick={() => tab.hidePrevLocation()}>Stay</button>
    </Bar>
  )
}

function KindleProgress({ tab }: { tab: BookTab }) {
  const { location, book } = useSnapshot(tab)
  const [mode, setMode] = useState(0)
  const percentage = ((book.percentage ?? 0) * 100).toFixed()

  if (!location) return null

  const page = location.start.displayed.page
  const total = location.start.displayed.total

  let origPage: number | undefined
  let origTotal: number | undefined
  try {
    const pl = (tab.epub as any)?.pageList
    if (pl && pl.locations?.length > 0) {
      origPage = pl.pageFromCfi(location.start.cfi)
      origTotal = pl.lastPage
    }
  } catch {}

  const hasOrig = origPage != null && origPage > 0 && origTotal != null && origTotal > 0
  const toggle = () => setMode((m) => (m + 1) % (hasOrig ? 2 : 1))

  let leftText: string
  if (mode === 1 && hasOrig) {
    leftText = `p.${origPage} / ${origTotal}`
  } else {
    leftText = `${page} / ${total}`
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '4px 16px 2px',
        fontSize: 11,
        color: 'rgba(128,128,128,0.5)',
        userSelect: 'none',
        flexShrink: 0,
        letterSpacing: '0.02em',
        cursor: hasOrig ? 'pointer' : 'default',
      }}
      onClick={toggle}
    >
      <span>{leftText}</span>
      <span>{percentage}%</span>
    </div>
  )
}

function ProgressBar({ percentage }: { percentage: number }) {
  return (
    <div
      style={{
        height: 2,
        background: 'rgba(0,0,0,0.06)',
        width: '100%',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${percentage}%`,
          background: 'rgba(0,0,0,0.2)',
          transition: 'width 0.3s ease',
        }}
      />
    </div>
  )
}

interface LineProps extends ComponentProps<'div'> {}
const Bar: React.FC<LineProps> = ({ className, ...props }) => {
  return (
    <div
      className={clsx(
        'typescale-body-small text-outline flex h-6 items-center justify-between gap-2 px-[4vw] sm:px-2',
        className,
      )}
      {...props}
    ></div>
  )
}
