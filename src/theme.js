export const THEME_MODES = ['light', 'system', 'dark']
export const THEME_STORAGE_KEY = 'open_kounter_theme'

export const getStoredThemeMode = () => {
  const storedMode = localStorage.getItem(THEME_STORAGE_KEY)
  return THEME_MODES.includes(storedMode) ? storedMode : 'system'
}

export const getResolvedTheme = (mode, prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches) => {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode
}

export const applyThemeMode = (mode, prefersDark) => {
  const resolvedTheme = getResolvedTheme(mode, prefersDark)
  const root = document.documentElement

  root.dataset.theme = resolvedTheme
  root.dataset.themeMode = mode

  return resolvedTheme
}

export const saveThemeMode = (mode) => {
  if (!THEME_MODES.includes(mode)) return
  localStorage.setItem(THEME_STORAGE_KEY, mode)
}
