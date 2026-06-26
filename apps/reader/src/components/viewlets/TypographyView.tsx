import clsx from 'clsx'
import { useCallback, useRef, useState } from 'react'
import { MdAdd, MdRemove } from 'react-icons/md'

import { RenditionSpread } from '@flow/epubjs/types/rendition'
import { useColorScheme, useTranslation } from '@flow/reader/hooks'
import { reader, useReaderSnapshot } from '@flow/reader/models'
import {
  defaultSettings,
  readingThemes,
  TextAlign,
  TypographyConfiguration,
  useSettings,
} from '@flow/reader/state'
import { keys } from '@flow/reader/utils'

import { Select, TextField, TextFieldProps } from '../Form'
import { PaneViewProps, PaneView, Pane } from '../base'

// Define an interface for the Font object

enum TypographyScope {
  Book,
  Global,
}

const fontPresets = [
  { key: 'serif', family: '"Georgia", "Noto Serif", "Songti SC", serif' },
  {
    key: 'sans',
    family:
      '-apple-system, "Noto Sans", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  { key: 'kai', family: '"Kaiti SC", "STKaiti", "Noto Serif CJK SC", serif' },
]

export const TypographyView: React.FC<PaneViewProps> = (props) => {
  const { focusedBookTab } = useReaderSnapshot()
  const [settings, setSettings] = useSettings()
  const [scope, setScope] = useState(TypographyScope.Book)
  const t = useTranslation('typography')
  const { dark } = useColorScheme()
  const activeTheme = settings.readingTheme ?? 'default'

  const [localFonts, setLocalFonts] = useState<string[]>()

  const {
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    zoom,
    spread,
    textAlign,
    maxWidth,
  } =
    scope === TypographyScope.Book
      ? focusedBookTab?.book.configuration?.typography ?? defaultSettings
      : settings

  const setTypography = useCallback(
    <K extends keyof TypographyConfiguration>(
      k: K,
      v: TypographyConfiguration[K],
    ) => {
      if (scope === TypographyScope.Book) {
        reader.focusedBookTab?.updateBook({
          configuration: {
            ...reader.focusedBookTab.book.configuration,
            typography: {
              ...reader.focusedBookTab.book.configuration?.typography,
              [k]: v,
            },
          },
        })
      } else {
        setSettings((prev) => ({
          ...prev,
          [k]: v,
        }))
      }
    },
    [scope, setSettings],
  )

  const queryLocalFonts = useCallback(async () => {
    if (localFonts) return
    if (!('queryLocalFonts' in window)) {
      console.error('queryLocalFonts is not available')
      return
    }

    try {
      const fonts = await window.queryLocalFonts()
      const uniqueFonts = Array.from(new Set(fonts.map((f) => f.family)))
      setLocalFonts(uniqueFonts)
    } catch (error) {
      console.error('Error querying local fonts:', error)
    }
  }, [localFonts])

  return (
    <PaneView {...props}>
      <div className="typescale-body-medium flex gap-2 px-5 pb-2 !text-[13px]">
        {keys(TypographyScope)
          .filter((k) => isNaN(Number(k)))
          .map((scopeName) => (
            <button
              key={scopeName}
              className={clsx(
                TypographyScope[scopeName] === scope
                  ? 'text-on-surface-variant'
                  : 'text-outline/60',
              )}
              onClick={() => setScope(TypographyScope[scopeName])}
            >
              {t(`scope.${scopeName.toLowerCase()}`)}
            </button>
          ))}
      </div>
      <Pane
        headline={t('title')}
        className="space-y-3 px-5 pt-2 pb-4"
        key={`${scope}${focusedBookTab?.id}`}
      >
        <div>
          <div className="typescale-label-medium text-on-surface-variant mb-1.5 block !text-[13px]">
            {t('reading_theme')}
          </div>
          <div className="flex flex-wrap gap-2">
            {readingThemes.map((rt) => {
              const active = activeTheme === rt.key
              const bg = rt.bg || (dark ? '#1c1c1e' : '#ffffff')
              const fg = rt.fg || (dark ? '#bfc8ca' : '#3f484a')
              return (
                <button
                  key={rt.key}
                  title={t(`theme.${rt.key}`)}
                  aria-label={t(`theme.${rt.key}`)}
                  onClick={() =>
                    setSettings((prev) => ({ ...prev, readingTheme: rt.key }))
                  }
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-full text-[13px] leading-none',
                    active ? 'ring-primary ring-2' : 'ring-outline/20 ring-1',
                  )}
                  style={{ background: bg, color: fg }}
                >
                  A
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <div className="typescale-label-medium text-on-surface-variant mb-1.5 block !text-[13px]">
            {t('font_preset')}
          </div>
          <div className="flex flex-wrap gap-2">
            {fontPresets.map((f) => (
              <button
                key={f.key}
                onClick={() => setTypography('fontFamily', f.family)}
                className="bg-default text-on-surface-variant rounded px-2.5 py-1 !text-[13px]"
                style={{ fontFamily: f.family }}
              >
                {t(`font_preset.${f.key}`)}
              </button>
            ))}
          </div>
        </div>
        <Select
          name={t('page_view')}
          value={spread ?? RenditionSpread.Auto}
          onChange={(e) => {
            setTypography('spread', e.target.value as RenditionSpread)
          }}
        >
          <option value={RenditionSpread.None}>
            {t('page_view.single_page')}
          </option>
          <option value={RenditionSpread.Auto}>
            {t('page_view.double_page')}
          </option>
        </Select>
        <TextField
          as="input"
          name={t('font_family')}
          value={fontFamily}
          placeholder="default"
          // Tips: Datalist only appears on mouse click or keyboard input.
          // Does not show when focused via Tab/focus() or triggered by click()
          datalist={localFonts?.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
          onFocus={queryLocalFonts}
          // Preload fonts to ensure `localFonts` is available on first mouse click.
          // Without preloading, datalist dropdown will be empty for the first mouse click.
          onMouseEnter={queryLocalFonts}
          onChange={(e) => {
            setTypography('fontFamily', e.target.value)
          }}
        />
        <NumberField
          name={t('font_size')}
          min={14}
          max={36}
          defaultValue={fontSize && parseInt(fontSize)}
          onChange={(v) => {
            setTypography('fontSize', v ? v + 'px' : undefined)
          }}
        />
        <NumberField
          name={t('font_weight')}
          min={100}
          max={900}
          step={100}
          defaultValue={fontWeight}
          onChange={(v) => {
            setTypography('fontWeight', v || undefined)
          }}
        />
        <NumberField
          name={t('line_height')}
          min={1}
          step={0.1}
          defaultValue={lineHeight}
          onChange={(v) => {
            setTypography('lineHeight', v || undefined)
          }}
        />
        <Select
          name={t('text_align')}
          value={textAlign ?? ''}
          onChange={(e) => {
            setTypography(
              'textAlign',
              (e.target.value || undefined) as TextAlign | undefined,
            )
          }}
        >
          <option value="">{t('text_align.default')}</option>
          <option value="justify">{t('text_align.justify')}</option>
          <option value="left">{t('text_align.left')}</option>
        </Select>
        <Select
          name={t('page_width')}
          value={String(maxWidth ?? 800)}
          onChange={(e) => {
            setTypography('maxWidth', Number(e.target.value))
          }}
        >
          <option value="600">{t('page_width.narrow')}</option>
          <option value="800">{t('page_width.standard')}</option>
          <option value="1000">{t('page_width.wide')}</option>
          <option value="9999">{t('page_width.full')}</option>
        </Select>
        <NumberField
          name={t('zoom')}
          min={1}
          step={0.1}
          defaultValue={zoom}
          onChange={(v) => {
            setTypography('zoom', v || undefined)
          }}
        />
      </Pane>
    </PaneView>
  )
}

interface NumberFieldProps extends Omit<TextFieldProps<'input'>, 'onChange'> {
  onChange: (v?: number) => void
}
const NumberField: React.FC<NumberFieldProps> = ({ onChange, ...props }) => {
  const ref = useRef<HTMLInputElement>(null)
  const t = useTranslation('action')

  return (
    <TextField
      as="input"
      type="number"
      placeholder="default"
      actions={[
        {
          title: t('step_down'),
          Icon: MdRemove,
          onClick: () => {
            if (!ref.current) return
            ref.current.stepDown()
            onChange(Number(ref.current.value))
          },
        },
        {
          title: t('step_up'),
          Icon: MdAdd,
          onClick: () => {
            if (!ref.current) return
            ref.current.stepUp()
            onChange(Number(ref.current.value))
          },
        },
      ]}
      mRef={ref}
      // lazy render
      onBlur={(e) => {
        onChange(Number(e.target.value))
      }}
      onClear={() => {
        if (ref.current) ref.current.value = ''
        onChange(undefined)
      }}
      {...props}
    />
  )
}
