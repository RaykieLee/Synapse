import { useSyncExternalStore } from 'react'
import { lookupTranslation, type Locale } from './i18n/catalog'
import { translationLookupChains } from './i18n/index'

export type { Locale } from './i18n/catalog'

const STORAGE_KEY = 'synapse-locale'
const LEGACY_CHINESE_SOURCE = /[\u3400-\u9fff]/
const listeners = new Set<() => void>()
let locale: Locale = readLocale()

function readLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN'
  return window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh-CN'
}

function syncDocumentLanguage(next: Locale) {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = next
  }
}

syncDocumentLanguage(locale)

export function getLocale() {
  return locale
}

export function setLocale(next: Locale) {
  const changed = locale !== next
  locale = next
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next)
  syncDocumentLanguage(next)
  if (changed) listeners.forEach((listener) => listener())
}

export function syncLocaleFromStorage() {
  setLocale(readLocale())
}

export function useLocale() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getLocale,
    (): Locale => 'zh-CN',
  )
}

export function useLocaleText() {
  const currentLocale = useLocale()
  return (text: string) => translate(text, currentLocale)
}

export function translate(text: string, target: Locale = locale) {
  const trimmed = text.trim()
  const preserve = (value: string) =>
    `${text.slice(0, text.indexOf(trimmed))}${value}${text.slice(text.indexOf(trimmed) + trimmed.length)}`

  if (target === 'en') {
    const translated = lookupTranslation(
      translationLookupChains,
      trimmed,
      'en',
    )
    return translated ? preserve(translated) : text
  }

  const translated = lookupTranslation(
    translationLookupChains,
    trimmed,
    'zh-CN',
    { throughChainOrder: 2 },
  )
  if (translated) return preserve(translated)

  // Some legacy entries use Chinese source keys in the English-to-Chinese map.
  // Keep authored Chinese text unchanged instead of translating it backwards.
  if (!LEGACY_CHINESE_SOURCE.test(trimmed)) {
    const fallback = lookupTranslation(
      translationLookupChains,
      trimmed,
      'zh-CN',
      { fromChainOrder: 3 },
    )
    if (fallback) return preserve(fallback)
  }

  return text
}

export const t = translate

export function formatMessage(
  message: string,
  values: Record<string, string>,
  target: Locale = locale,
) {
  return translate(message, target).replace(
    /\{(\w+)\}/g,
    (_, key: string) => values[key] ?? `{${key}}`,
  )
}
