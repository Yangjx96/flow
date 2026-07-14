import Dexie from 'dexie'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { MdVisibility, MdVisibilityOff } from 'react-icons/md'

import {
  ColorScheme,
  useColorScheme,
  useTranslation,
} from '@flow/reader/hooks'
import { useSyncStatus } from '@flow/reader/hooks/remote/useServerSync'
import { setUserEnabled } from '@flow/reader/server-sync'
import {
  useTtsConfig,
  TtsConfig,
  ApiPreset,
  TranslateSource,
  activeSources,
} from '@flow/reader/state'

import { localeNames } from '../../../locales'
import { Button } from '../Button'
import { Checkbox, Label, Select, TextField } from '../Form'
import { Page } from '../Page'

const genId = () => Math.random().toString(36).slice(2, 10)

// let the user paste just a domain: add https:// and the endpoint path
function normalizeApiUrl(input: string, defaultPath?: string) {
  let t = input.trim()
  if (!t) return t
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`
  if (!defaultPath) return t
  try {
    const u = new URL(t)
    if (u.pathname === '/' || u.pathname === '') {
      u.pathname = defaultPath
      return u.toString()
    }
  } catch {}
  return t
}

export const Settings: React.FC = () => {
  const { scheme, setScheme } = useColorScheme()
  const { asPath, push, locale, locales } = useRouter()
  const t = useTranslation('settings')

  return (
    <Page headline={t('title')}>
      <div className="max-w-xl space-y-6">
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
        <SyncSettings />

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

  const sources = activeSources(cfg)
  const toggleSource = (s: TranslateSource) => {
    let next = sources.includes(s)
      ? sources.filter((x) => x !== s)
      : [...sources, s]
    if (!next.length) return // keep at least one source
    // stable display order: google above llm
    next = (['google', 'llm'] as TranslateSource[]).filter((x) =>
      next.includes(x),
    )
    update({
      translateSources: next,
      // mirror into the legacy field so a rollback keeps working
      translateMethod: next.includes('llm') ? 'llm' : 'google',
    })
  }

  // seed the preset list from the legacy single config on first use
  const presets: ApiPreset[] = cfg.llmPresets?.length
    ? cfg.llmPresets
    : [
        {
          id: 'default',
          name: t('preset.default'),
          url: cfg.llmApi.url,
          key: cfg.llmApi.key,
        },
      ]
  const activeId =
    cfg.llmActiveId && presets.some((p) => p.id === cfg.llmActiveId)
      ? cfg.llmActiveId
      : presets[0]!.id

  const commit = (list: ApiPreset[], id: string) => {
    const a = list.find((p) => p.id === id) ?? list[0]
    update({
      llmPresets: list,
      llmActiveId: a?.id,
      // mirror the active preset into the legacy field (server env fallback
      // and older builds keep working)
      llmApi: { url: a?.url ?? '', key: a?.key ?? '' },
    })
  }

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
            <Field name={t('translation.sources')}>
              <div className="mt-1 space-y-2">
                <Checkbox
                  name={t('translation.google')}
                  checked={sources.includes('google')}
                  onChange={() => toggleSource('google')}
                />
                <Checkbox
                  name={t('translation.llm')}
                  checked={sources.includes('llm')}
                  onChange={() => toggleSource('llm')}
                />
              </div>
            </Field>
            {sources.includes('llm') && (
              <Advanced
                open={advanced}
                onToggle={() => setAdvanced((v) => !v)}
                label={t('advanced')}
              >
                <p className="text-outline mb-2 text-[12px]">
                  {t('api_note')}
                </p>
                <PresetManager
                  presets={presets}
                  activeId={activeId}
                  onCommit={commit}
                  showPrompt
                  modelDatalist={[
                    'gpt-4o-mini',
                    'gpt-4o',
                    'gpt-4.1-mini',
                    'deepseek-chat',
                    'deepseek-reasoner',
                    'gemini-2.0-flash',
                    'claude-3-5-haiku-latest',
                  ]}
                  modelPlaceholder="gpt-4o-mini"
                  urlPlaceholder="https://api.example.com"
                  urlDefaultPath="/v1/chat/completions"
                />
              </Advanced>
            )}
          </>
        )}
      </div>
    </Section>
  )
}

interface PresetManagerProps {
  presets: ApiPreset[]
  activeId: string
  onCommit: (presets: ApiPreset[], activeId: string) => void
  showPrompt?: boolean
  modelDatalist?: string[]
  modelPlaceholder?: string
  urlPlaceholder?: string
  urlDefaultPath?: string
}
const PresetManager: React.FC<PresetManagerProps> = ({
  presets,
  activeId,
  onCommit,
  showPrompt,
  modelDatalist,
  modelPlaceholder,
  urlPlaceholder,
  urlDefaultPath,
}) => {
  const t = useTranslation('settings')
  const [showKey, setShowKey] = useState(false)
  const active = presets.find((p) => p.id === activeId) ?? presets[0]!

  const patchActive = (patch: Partial<ApiPreset>) => {
    onCommit(
      presets.map((p) => (p.id === active.id ? { ...p, ...patch } : p)),
      active.id,
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-3">
        <Select
          name={t('preset')}
          className="w-56"
          value={active.id}
          onChange={(e) => onCommit(presets, e.target.value)}
        >
          {presets.map((p, i) => (
            <option key={p.id} value={p.id}>
              {p.name || `#${i + 1}`}
            </option>
          ))}
        </Select>
        <button
          className="text-outline hover:text-on-surface-variant shrink-0 pb-1 !text-[12px]"
          onClick={() => {
            const id = genId()
            onCommit([...presets, { id, name: '', url: '', key: '' }], id)
          }}
        >
          ＋ {t('preset.add')}
        </button>
        {presets.length > 1 && (
          <button
            className="text-outline hover:text-on-surface-variant shrink-0 pb-1 !text-[12px]"
            onClick={() => {
              const rest = presets.filter((p) => p.id !== active.id)
              onCommit(rest, rest[0]!.id)
            }}
          >
            − {t('preset.remove')}
          </button>
        )}
      </div>
      {/* remount on preset switch so the uncontrolled fields show its values */}
      <div key={active.id} className="space-y-2">
        <TextField
          name={t('preset.name')}
          defaultValue={active.name}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
            patchActive({ name: e.target.value })
          }
        />
        <div>
          <TextField
            name={t('api_url')}
            defaultValue={active.url}
            onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
              const v = normalizeApiUrl(e.target.value, urlDefaultPath)
              e.target.value = v
              patchActive({ url: v })
            }}
            placeholder={urlPlaceholder}
          />
          {urlDefaultPath && (
            <p className="text-outline mt-0.5 !text-[11px]">
              {t('api_url_hint')} {urlDefaultPath}
            </p>
          )}
        </div>
        <TextField
          name={t('api_key')}
          type={showKey ? 'text' : 'password'}
          defaultValue={active.key}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
            patchActive({ key: e.target.value })
          }
          placeholder="sk-..."
          actions={[
            {
              title: t('preset.show_key'),
              Icon: showKey ? MdVisibilityOff : MdVisibility,
              onClick: () => setShowKey((v) => !v),
            },
          ]}
        />
        <TextField
          name={t('preset.model')}
          defaultValue={active.model ?? ''}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
            patchActive({ model: e.target.value })
          }
          placeholder={modelPlaceholder}
          datalist={modelDatalist?.map((m) => (
            <option key={m} value={m} />
          ))}
        />
        {showPrompt && (
          <div>
            <Label name={t('preset.prompt')} />
            <textarea
              className="bg-default text-on-surface-variant placeholder:text-outline/60 scroll w-full resize-none px-1.5 py-1 !text-[13px]"
              rows={3}
              defaultValue={active.systemPrompt ?? ''}
              onBlur={(e) => patchActive({ systemPrompt: e.target.value })}
              placeholder={t('preset.prompt_hint')}
            />
          </div>
        )}
      </div>
    </div>
  )
}

const TtsSettings: React.FC = () => {
  const [cfg, setCfg] = useTtsConfig()
  const t = useTranslation('settings')
  const [advanced, setAdvanced] = useState(false)
  const update = (patch: Partial<TtsConfig>) => setCfg({ ...cfg, ...patch })

  // seed the preset list from the legacy single config on first use
  const presets: ApiPreset[] = cfg.ttsPresets?.length
    ? cfg.ttsPresets
    : [
        {
          id: 'default',
          name: t('preset.default'),
          url: cfg.ttsApi.url,
          key: cfg.ttsApi.key,
          model: cfg.ttsModel,
        },
      ]
  const activeId =
    cfg.ttsActiveId && presets.some((p) => p.id === cfg.ttsActiveId)
      ? cfg.ttsActiveId
      : presets[0]!.id

  const commit = (list: ApiPreset[], id: string) => {
    const a = list.find((p) => p.id === id) ?? list[0]
    update({
      ttsPresets: list,
      ttsActiveId: a?.id,
      // mirror the active preset into the legacy fields
      ttsApi: { url: a?.url ?? '', key: a?.key ?? '' },
      ...(a?.model ? { ttsModel: a.model } : {}),
    })
  }

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
              <PresetManager
                presets={presets}
                activeId={activeId}
                onCommit={commit}
                modelDatalist={['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']}
                modelPlaceholder="tts-1"
                urlPlaceholder="https://api.example.com"
                urlDefaultPath="/v1/audio/speech"
              />
            </Advanced>
          </>
        )}
      </div>
    </Section>
  )
}

const SyncSettings: React.FC = () => {
  const t = useTranslation('settings')
  const status = useSyncStatus()

  return (
    <Section title={t('sync')}>
      <div className="space-y-3">
        <Checkbox
          name={t('sync.enable')}
          checked={status !== 'disabled'}
          onChange={(e) => setUserEnabled(e.target.checked)}
        />
        <p className="text-outline !text-[12px]">
          {t(`sync.status.${status}`)}
        </p>
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
