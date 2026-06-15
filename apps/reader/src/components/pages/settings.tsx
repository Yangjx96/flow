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
        <Item title={t('language')}>
          <Select
            value={locale}
            onChange={(e) => {
              push(asPath, undefined, { locale: e.target.value })
            }}
          >
            {locales?.map((loc) => (
              <option key={loc} value={loc}>
                {localeNames[loc] || loc}
              </option>
            ))}
          </Select>
        </Item>
        <Item title={t('color_scheme')}>
          <Select
            value={scheme}
            onChange={(e) => {
              setScheme(e.target.value as ColorScheme)
            }}
          >
            <option value="system">{t('color_scheme.system')}</option>
            <option value="light">{t('color_scheme.light')}</option>
            <option value="dark">{t('color_scheme.dark')}</option>
          </Select>
        </Item>
        <TtsSettings />
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

const TtsSettings: React.FC = () => {
  const [cfg, setCfg] = useTtsConfig()

  const update = (patch: Partial<TtsConfig>) => setCfg({ ...cfg, ...patch })
  const updateShort = (patch: Partial<TtsConfig['shortApi']>) =>
    update({ shortApi: { ...cfg.shortApi, ...patch } })
  const updateLong = (patch: Partial<TtsConfig['longApi']>) =>
    update({ longApi: { ...cfg.longApi, ...patch } })

  return (
    <>
      <Item title="TTS & Translation">
        <div className="space-y-3">
          <Checkbox
            name="Enable TTS"
            checked={cfg.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <Checkbox
            name="Enable translation popup"
            checked={cfg.translateEnabled}
            onChange={(e) => update({ translateEnabled: e.target.checked })}
          />
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
            <div className="flex-1">
              <Label>Threshold</Label>
              <Select
                value={String(cfg.threshold)}
                onChange={(e) => update({ threshold: Number(e.target.value) })}
              >
                {['1', '2', '3', '5', '10'].map((n) => (
                  <option key={n} value={n}>
                    &le;{n} words
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      </Item>
      <Item title="Short sentence API">
        <div className="space-y-2">
          <TextField
            name="URL"
            defaultValue={cfg.shortApi.url}
            onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
              updateShort({ url: e.target.value })
            }
            placeholder="https://api.example.com/v1/audio/speech"
          />
          <TextField
            name="Key"
            defaultValue={cfg.shortApi.key}
            onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
              updateShort({ key: e.target.value })
            }
            placeholder="sk-..."
          />
        </div>
      </Item>
      <Item title="Long sentence API">
        <div className="space-y-2">
          <TextField
            name="URL"
            defaultValue={cfg.longApi.url}
            onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
              updateLong({ url: e.target.value })
            }
            placeholder="https://api.example.com/v1/audio/speech"
          />
          <TextField
            name="Key"
            defaultValue={cfg.longApi.key}
            onBlur={(e: React.FocusEvent<HTMLInputElement>) =>
              updateLong({ key: e.target.value })
            }
            placeholder="sk-..."
          />
        </div>
      </Item>
    </>
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
