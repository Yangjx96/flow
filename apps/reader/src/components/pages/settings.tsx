import Dexie from 'dexie'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'

import {
  ColorScheme,
  useColorScheme,
  useTranslation,
} from '@flow/reader/hooks'
import { useTtsConfig, TtsConfig } from '@flow/reader/state'

import { localeNames } from '../../../locales'
import { Button } from '../Button'
import { Checkbox, Select, TextField } from '../Form'
import { Page } from '../Page'

export const Settings: React.FC = () => {
  const { scheme, setScheme } = useColorScheme()
  const { asPath, push, locale, locales } = useRouter()
  const t = useTranslation('settings')

  return (
    <Page headline={t('title')}>
      <div className="space-y-6">
        <Section title={t('appearance')}>
          <Field name={t('color_scheme')}>
            <Select
              value={scheme}
              onChange={(e) => setScheme(e.target.value as ColorScheme)}
            >
              <option value="system">{t('color_scheme.system')}</option>
              <option value="light">{t('color_scheme.light')}</option>
              <option value="dark">{t('color_scheme.dark')}</option>
            </Select>
          </Field>
        </Section>

        <TranslateSettings />
        <TtsSettings />
        <InteractionSettings />

        <Section title={t('language')}>
          <Select
            value={locale}
            onChange={(e) => push(asPath, undefined, { locale: e.target.value })}
          >
            {locales?.map((loc) => (
              <option key={loc} value={loc}>
                {localeNames[loc] || loc}
              </option>
            ))}
          </Select>
        </Section>

        <Section title={t('data')}>
          <Button
            variant="secondary"
            onClick={() => {
              if (!confirm('Clear all data?')) return
              window.localStorage.clear()
              Dexie.getDatabaseNames().then((names) => {
                names.forEach((n) => Dexie.delete(n))
              })
            }}
          >
            {t('cache.clear')}
          </Button>
        </Section>
      </div>
    </Page>
  )
}

const TranslateSettings: React.FC = () => {
  const [cfg, setCfg] = useTtsConfig()
  const t = useTranslation('settings')
  const [advanced, setAdvanced] = useState(false)
  const update = (patch: Partial<TtsConfig>) => setCfg({ ...cfg, ...patch })

  return (
    <Section title={t('translation')}>
      <div className="space-y-3">
        <Checkbox
          name={t('translation.enable')}
          checked={cfg.translateEnabled}
          onChange={(e) => update({ translateEnabled: e.target.checked })}
        />
        {cfg.translateEnabled && (
          <>
            <Field name={t('translation.method')}>
              <Select
                value={cfg.translateMethod}
                onChange={(e) =>
                  update({ translateMethod: e.target.value as 'google' | 'llm' })
                }
              >
                <option value="google">{t('translation.google')}</option>
                <option value="llm">{t('translation.llm')}</option>
              </Select>
            </Field>
            {cfg.translateMethod === 'llm' && (
              <Advanced
                open={advanced}
                onToggle={() => setAdvanced((v) => !v)}
                label={t('advanced')}
              >
                <p className="text-outline mb-2 text-[12px]">
                  {t('api_note')}
                </p>
                <TextField
                  name={t('api_url')}
                  defaultValue={cfg.llmApi.url}
                  onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
                    update({ llmApi: { ...cfg.llmApi, url: e.target.value } })
                  }
                  placeholder="https://api.example.com/v1/chat/completions"
                />
                <TextField
                  name={t('api_key')}
                  type="password"
                  defaultValue={cfg.llmApi.key}
                  onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
                    update({ llmApi: { ...cfg.llmApi, key: e.target.value } })
                  }
                  placeholder="sk-..."
                />
              </Advanced>
            )}
          </>
        )}
      </div>
    </Section>
  )
}

const TtsSettings: React.FC = () => {
  const [cfg, setCfg] = useTtsConfig()
  const t = useTranslation('settings')
  const [advanced, setAdvanced] = useState(false)
  const update = (patch: Partial<TtsConfig>) => setCfg({ ...cfg, ...patch })

  return (
    <Section title={t('tts')}>
      <div className="space-y-3">
        <Checkbox
          name={t('tts.enable')}
          checked={cfg.ttsEnabled}
          onChange={(e) => update({ ttsEnabled: e.target.checked })}
        />
        {cfg.ttsEnabled && (
          <>
            <div className="flex gap-3">
              <Field name={t('tts.voice')} className="flex-1">
                <Select
                  value={cfg.voice}
                  onChange={(e) => update({ voice: e.target.value })}
                >
                  {['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map(
                    (v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ),
                  )}
                </Select>
              </Field>
              <Field name={t('tts.speed')} className="flex-1">
                <Select
                  value={String(cfg.speed)}
                  onChange={(e) => update({ speed: Number(e.target.value) })}
                >
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                    <option key={s} value={String(s)}>
                      {s}x
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field name={t('tts.model')}>
              <Select
                value={cfg.ttsModel}
                onChange={(e) => update({ ttsModel: e.target.value })}
              >
                {['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field name={t('tts.max_words')}>
              <input
                type="number"
                min={0}
                className="bg-default text-on-surface-variant w-24 px-1.5 py-1 !text-[13px]"
                value={cfg.ttsMaxWords ?? 30}
                onChange={(e) =>
                  update({ ttsMaxWords: Math.max(0, Number(e.target.value) || 0) })
                }
              />
              <p className="text-outline mt-1 !text-[12px]">
                {t('tts.max_words.hint')}
              </p>
            </Field>
            <Advanced
              open={advanced}
              onToggle={() => setAdvanced((v) => !v)}
              label={t('advanced')}
            >
              <p className="text-outline mb-2 text-[12px]">{t('api_note')}</p>
              <TextField
                name={t('api_url')}
                defaultValue={cfg.ttsApi.url}
                onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
                  update({ ttsApi: { ...cfg.ttsApi, url: e.target.value } })
                }
                placeholder="https://api.example.com/v1/audio/speech"
              />
              <TextField
                name={t('api_key')}
                type="password"
                defaultValue={cfg.ttsApi.key}
                onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
                  update({ ttsApi: { ...cfg.ttsApi, key: e.target.value } })
                }
                placeholder="sk-..."
              />
            </Advanced>
          </>
        )}
      </div>
    </Section>
  )
}

const InteractionSettings: React.FC = () => {
  const [cfg, setCfg] = useTtsConfig()
  const t = useTranslation('settings')
  const update = (patch: Partial<TtsConfig>) => setCfg({ ...cfg, ...patch })

  return (
    <Section title={t('interaction')}>
      <div className="space-y-3">
        <Field name={t('trigger')}>
          <Select
            value={cfg.autoOnSelect ? 'select' : 'shortcut'}
            onChange={(e) => update({ autoOnSelect: e.target.value === 'select' })}
          >
            <option value="shortcut">{t('trigger.shortcut')}</option>
            <option value="select">{t('trigger.select')}</option>
          </Select>
        </Field>
        <ShortcutField
          label={t('shortcut.translate')}
          value={cfg.translateShortcut}
          onChange={(k) => update({ translateShortcut: k })}
        />
        <ShortcutField
          label={t('shortcut.tts')}
          value={cfg.ttsShortcut}
          onChange={(k) => update({ ttsShortcut: k })}
        />
        <Checkbox
          name={t('snap_words')}
          checked={cfg.snapToWords ?? true}
          onChange={(e) => update({ snapToWords: e.target.checked })}
        />
        <Checkbox
          name={t('auto_dismiss')}
          checked={cfg.autoDismiss ?? true}
          onChange={(e) => update({ autoDismiss: e.target.checked })}
        />
        <Checkbox
          name={t('click_select')}
          checked={cfg.clickSelectsWord ?? false}
          onChange={(e) => update({ clickSelectsWord: e.target.checked })}
        />
        <Checkbox
          name={t('hover_select')}
          checked={cfg.hoverSelectsWord ?? false}
          onChange={(e) => update({ hoverSelectsWord: e.target.checked })}
        />
      </div>
    </Section>
  )
}

interface ShortcutFieldProps {
  label: string
  value: string
  onChange: (key: string) => void
}
const ShortcutField: React.FC<ShortcutFieldProps> = ({
  label,
  value,
  onChange,
}) => {
  const [capturing, setCapturing] = useState(false)
  const t = useTranslation('settings')

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      if (e.key === 'Escape') {
        setCapturing(false)
        return
      }
      if (e.key.length === 1) {
        onChange(e.key.toLowerCase())
        setCapturing(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, onChange])

  return (
    <div className="flex items-center">
      <span className="typescale-label-medium text-on-surface-variant !text-[13px]">
        {label}
      </span>
      <button
        className="bg-default text-on-surface-variant ml-auto min-w-[3.5rem] rounded px-2 py-1 text-center !text-[13px] uppercase"
        onClick={() => setCapturing(true)}
      >
        {capturing ? t('shortcut.press') : value.toUpperCase()}
      </button>
    </div>
  )
}

interface AdvancedProps {
  open: boolean
  onToggle: () => void
  label: string
}
const Advanced: React.FC<AdvancedProps> = ({
  open,
  onToggle,
  label,
  children,
}) => (
  <div>
    <button
      className="text-outline hover:text-on-surface-variant !text-[12px]"
      onClick={onToggle}
    >
      {open ? '▾ ' : '▸ '}
      {label}
    </button>
    {open && <div className="mt-2 space-y-2">{children}</div>}
  </div>
)

interface FieldProps {
  name: string
  className?: string
}
const Field: React.FC<FieldProps> = ({ name, className, children }) => (
  <div className={className}>
    <div className="typescale-label-small text-on-surface-variant mb-1">
      {name}
    </div>
    {children}
  </div>
)

interface SectionProps {
  title: string
}
const Section: React.FC<SectionProps> = ({ title, children }) => (
  <div>
    <h3 className="typescale-title-small text-on-surface-variant">{title}</h3>
    <div className="mt-2">{children}</div>
  </div>
)

Settings.displayName = 'settings'
