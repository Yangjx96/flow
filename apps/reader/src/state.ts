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
  fontFamily: '"Georgia", "Noto Serif", "Times New Roman", serif',
  fontSize: '20px',
  lineHeight: 1.8,
  spread: RenditionSpread.None,
  enableTextSelectionMenu: false,
}

const settingsState = atom<Settings>({
  key: 'settingsV2',
  default: defaultSettings,
  effects: [localStorageEffect('settingsV2', defaultSettings)],
})

export function useSettings() {
  return useRecoilState(settingsState)
}

export interface TtsConfig {
  ttsEnabled: boolean
  translateEnabled: boolean
  translateMethod: 'google' | 'llm'
  llmApi: { url: string; key: string }
  ttsApi: { url: string; key: string }
  voice: string
  speed: number
}

export const defaultTtsConfig: TtsConfig = {
  ttsEnabled: false,
  translateEnabled: true,
  translateMethod: 'google',
  llmApi: { url: '', key: '' },
  ttsApi: { url: '', key: '' },
  voice: 'alloy',
  speed: 1.0,
}

const ttsConfigState = atom<TtsConfig>({
  key: 'ttsConfig2',
  default: defaultTtsConfig,
  effects: [localStorageEffect('ttsConfig2', defaultTtsConfig)],
})

export function useTtsConfig() {
  return useRecoilState(ttsConfigState)
}
