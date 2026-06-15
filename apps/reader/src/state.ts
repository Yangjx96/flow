import { IS_SERVER } from '@literal-ui/hooks'
import { atom, AtomEffect, useRecoilState } from 'recoil'

import { RenditionSpread } from '@flow/epubjs/types/rendition'

function localStorageEffect<T>(key: string, defaultValue: T): AtomEffect<T> {
  return ({ setSelf, onSet }) => {
    if (IS_SERVER) return

    const savedValue = localStorage.getItem(key)
    if (savedValue === null) {
      localStorage.setItem(key, JSON.stringify(defaultValue))
    } else {
      setSelf(JSON.parse(savedValue))
    }

    onSet((newValue, _, isReset) => {
      isReset
        ? localStorage.removeItem(key)
        : localStorage.setItem(key, JSON.stringify(newValue))
    })
  }
}

export const navbarState = atom<boolean>({
  key: 'navbar',
  default: false,
})

export interface Settings extends TypographyConfiguration {
  theme?: ThemeConfiguration
  enableTextSelectionMenu?: boolean
}

export interface TypographyConfiguration {
  fontSize?: string
  fontWeight?: number
  fontFamily?: string
  lineHeight?: number
  spread?: RenditionSpread
  zoom?: number
}

interface ThemeConfiguration {
  source?: string
  background?: number
}

export const defaultSettings: Settings = {
  fontFamily: '"Times New Roman", Georgia, "Noto Serif", serif',
  fontSize: '18px',
  lineHeight: 1.6,
  spread: RenditionSpread.None,
  enableTextSelectionMenu: false,
}

const settingsState = atom<Settings>({
  key: 'settings',
  default: defaultSettings,
  effects: [localStorageEffect('settings', defaultSettings)],
})

export function useSettings() {
  return useRecoilState(settingsState)
}

export interface TtsConfig {
  enabled: boolean
  translateEnabled: boolean
  shortApi: { url: string; key: string }
  longApi: { url: string; key: string }
  model: string
  voice: string
  speed: number
  threshold: number
}

export const defaultTtsConfig: TtsConfig = {
  enabled: true,
  translateEnabled: true,
  shortApi: { url: '', key: '' },
  longApi: { url: '', key: '' },
  model: 'tts-1',
  voice: 'alloy',
  speed: 1.0,
  threshold: 2,
}

const ttsConfigState = atom<TtsConfig>({
  key: 'ttsConfig',
  default: defaultTtsConfig,
  effects: [localStorageEffect('ttsConfig', defaultTtsConfig)],
})

export function useTtsConfig() {
  return useRecoilState(ttsConfigState)
}
