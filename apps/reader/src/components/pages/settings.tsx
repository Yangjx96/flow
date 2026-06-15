import Dexie from 'dexie'
import { useRouter } from 'next/router'

import {
  ColorScheme,
  useColorScheme,
  useTranslation,
} from '@flow/reader/hooks'
import { localeNames } from '../../../locales'
import { useTtsConfig, TtsConfig } from '@flow/reader/state'

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
        <Item title={t('color_scheme')}>
          <Select
            value={scheme}
            onChange={(e) => setScheme(e.target.value as ColorScheme)}
          >
            <option value="system">{t('color_scheme.system')}</option>
            <option value="light">{t('color_scheme.light')}</option>
            <option value="dark">{t('color_scheme.dark')}</option>
          </Select>
        </Item>
        <TranslateSettings />
        <TtsSettings />
        <Item title={t('language')}>
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
        </Item>
        <Item title={t('cache')}>
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
        </Item>
      </div>
    </Page>
  )
}

const TranslateSettings: React.FC = () => {
  const [cfg, setCfg] = useTtsConfig()
  const update = (patch: Partial<TtsConfig>) => setCfg({ ...cfg, ...patch })

  return (
    <>
      <Item title="Translation">
        <div className="space-y-3">
          <Checkbox
            name="Enable translation on text selection"
            checked={cfg.translateEnabled}
            onChange={(e) => update({ translateEnabled: e.target.checked })}
          />
          <div>
            <Label>Method</Label>
            <Select
              value={cfg.translateMethod}
              onChange={(e) =>
                update({
                  translateMethod: e.target.value as 'google' | 'llm',
                })
              }
            >
              <option value="google">Google Translate (free)</option>
              <option value="llm">LLM (requires API key)</option>
            </Select>
          </div>
          {cfg.translateMethod === 'llm' && (
            <div className="space-y-2">
              <TextField
                name="LLM API URL"
                defaultValue={cfg.llmApi.url}
                onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
                  update({
                    llmApi: { ...cfg.llmApi, url: e.target.value },
                  })
                }
                placeholder="https://api.example.com/v1/chat/completions"
              />
              <TextField
                name="LLM API Key"
                defaultValue={cfg.llmApi.key}
                onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
                  update({
                    llmApi: { ...cfg.llmApi, key: e.target.value },
                  })
                }
                placeholder="sk-..."
              />
            </div>
          )}
        </div>
      </Item>
    </>
  )
}

const TtsSettings: React.FC = () => {
  const [cfg, setCfg] = useTtsConfig()
  const update = (patch: Partial<TtsConfig>) => setCfg({ ...cfg, ...patch })

  return (
    <Item title="TTS (Text-to-Speech)">
      <div className="space-y-3">
        <Checkbox
          name="Enable auto-pronunciation on text selection"
          checked={cfg.ttsEnabled}
          onChange={(e) => update({ ttsEnabled: e.target.checked })}
        />
        {cfg.ttsEnabled && (
          <>
            <div className="space-y-2">
              <TextField
                name="TTS API URL"
                defaultValue={cfg.ttsApi.url}
                onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
                  update({
                    ttsApi: { ...cfg.ttsApi, url: e.target.value },
                  })
                }
                placeholder="https://api.example.com/v1/audio/speech"
              />
              <TextField
                name="TTS API Key"
                defaultValue={cfg.ttsApi.key}
                onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
                  update({
                    ttsApi: { ...cfg.ttsApi, key: e.target.value },
                  })
                }
                placeholder="sk-..."
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <Label>Voice</Label>
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
              </div>
              <div className="flex-1">
                <Label>Speed</Label>
                <Select
                  value={String(cfg.speed)}
                  onChange={(e) => update({ speed: Number(e.target.value) })}
                >
                  {['0.5', '0.75', '1.0', '1.25', '1.5', '2.0'].map((s) => (
                    <option key={s} value={s}>
                      {s}x
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </>
        )}
      </div>
    </Item>
  )
}

const Label: React.FC = ({ children }) => (
  <div className="typescale-label-small text-on-surface-variant mb-1">
    {children}
  </div>
)

interface PartProps {
  title: string
}
const Item: React.FC<PartProps> = ({ title, children }) => {
  return (
    <div>
      <h3 className="typescale-title-small text-on-surface-variant">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  )
}

Settings.displayName = 'settings'
