import { createI18n } from 'vue-i18n'

import enUS from './locales/en-US.js'
import zhCN from './locales/zh-CN.js'

export const DEFAULT_LOCALE = 'zh-CN'
export const SUPPORTED_LOCALES = ['zh-CN', 'en-US']
export const LOCALE_STORAGE_KEY = 'open_kounter_locale'

export const getStoredLocale = () => {
  const storedLocale = localStorage.getItem(LOCALE_STORAGE_KEY)
  return SUPPORTED_LOCALES.includes(storedLocale) ? storedLocale : DEFAULT_LOCALE
}

export const applyLocale = (locale) => {
  const resolvedLocale = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE
  document.documentElement.lang = resolvedLocale
  return resolvedLocale
}

export const saveLocale = (locale) => {
  const resolvedLocale = applyLocale(locale)
  localStorage.setItem(LOCALE_STORAGE_KEY, resolvedLocale)
  return resolvedLocale
}

const locale = applyLocale(getStoredLocale())

export default createI18n({
  fallbackLocale: DEFAULT_LOCALE,
  legacy: false,
  locale,
  messages: {
    'en-US': enUS,
    'zh-CN': zhCN
  }
})
