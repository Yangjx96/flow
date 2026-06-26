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

export type TextAlign = 'left' | 'justify'

export interface TypographyConfiguration {
  fontSize?: string
  fontWeight?: number
  fontFamily?: string
  lineHeight?: number
  spread?: RenditionSpread
  zoom?: number
  textAlign?: TextAlign
  letterSpacing?: string
  maxWidth?: number
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
  textAlign: 'justify',
  maxWidth: 800,
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
  // when true, fire automatically on text selection; otherwise wait for a shortcut
  autoOnSelect: boolean
  // single lowercase key that triggers translate / pronounce on the current selection
  translateShortcut: string
  ttsShortcut: string
  translateMethod: 'google' | 'llm'
  llmApi: { url: string; key: string }
  ttsApi: { url: string; key: string }
  ttsModel: string
  voice: string
  speed: number
}

export const defaultTtsConfig: TtsConfig = {
  ttsEnabled: true,
  translateEnabled: true,
  autoOnSelect: false,
  translateShortcut: 'd',
  ttsShortcut: 's',
  translateMethod: 'llm',
  llmApi: { url: '', key: '' },
  ttsApi: { url: '', key: '' },
  ttsModel: 'tts-1',
  voice: 'alloy',
  speed: 1.0,
}

const ttsConfigState = atom<TtsConfig>({
  key: 'ttsConfig3',
  default: defaultTtsConfig,
  effects: [localStorageEffect('ttsConfig3', defaultTtsConfig)],
})

export function useTtsConfig() {
  return useRecoilState(ttsConfigState)
}
