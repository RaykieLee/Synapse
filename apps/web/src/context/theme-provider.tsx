import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import { getCookie, setCookie, removeCookie } from '@/lib/cookies'

type Theme = 'dark' | 'light' | 'system'
type ResolvedTheme = Exclude<Theme, 'system'>

const DEFAULT_THEME = 'system'
const THEME_COOKIE_NAME = 'vite-ui-theme'
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

type ThemeCookieStage = { rollback: () => boolean }
type ThemeCookieFailure = Error & {
  cause?: unknown
  rollbackConfirmed: boolean
  writeAttempted: boolean
}

function readThemeCookie(storageKey: string): Theme | undefined {
  try {
    const savedTheme = getCookie(storageKey)
    return savedTheme === 'system' || savedTheme === 'light' || savedTheme === 'dark'
      ? savedTheme
      : undefined
  } catch {
    return undefined
  }
}

function restoreThemeCookie(storageKey: string, theme: string | undefined) {
  try {
    if (theme === undefined) removeCookie(storageKey)
    else setCookie(storageKey, theme, THEME_COOKIE_MAX_AGE)
    return getCookie(storageKey) === theme
  } catch {
    return false
  }
}

function stageThemeCookie(storageKey: string, theme: Theme): ThemeCookieStage {
  let previousTheme: string | undefined
  let writeAttempted = false

  try {
    previousTheme = getCookie(storageKey)
    writeAttempted = true
    setCookie(storageKey, theme, THEME_COOKIE_MAX_AGE)
    if (getCookie(storageKey) !== theme) {
      throw new Error('Theme cookie write was not confirmed.')
    }
  } catch (cause) {
    const rollbackConfirmed = writeAttempted
      ? restoreThemeCookie(storageKey, previousTheme)
      : false
    const failure = new Error(
      'Theme cookie write could not be confirmed.'
    ) as ThemeCookieFailure
    Object.assign(failure, { cause, rollbackConfirmed, writeAttempted })
    throw failure
  }

  return { rollback: () => restoreThemeCookie(storageKey, previousTheme) }
}

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  defaultTheme: Theme
  resolvedTheme: ResolvedTheme
  theme: Theme
  setTheme: (theme: Theme) => void
  stageTheme: (theme: Theme) => ThemeCookieStage
  applyTheme: (theme: Theme) => void
  resetTheme: () => void
}

const initialState: ThemeProviderState = {
  defaultTheme: DEFAULT_THEME,
  resolvedTheme: 'light',
  theme: DEFAULT_THEME,
  setTheme: () => null,
  stageTheme: () => ({ rollback: () => true }),
  applyTheme: () => null,
  resetTheme: () => null,
}

const ThemeContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
  storageKey = THEME_COOKIE_NAME,
  ...props
}: ThemeProviderProps) {
  const [theme, _setTheme] = useState<Theme>(
    () => readThemeCookie(storageKey) || defaultTheme
  )

  // Optimized: Memoize the resolved theme calculation to prevent unnecessary re-computations
  const resolvedTheme = useMemo((): ResolvedTheme => {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    }
    return theme as ResolvedTheme
  }, [theme])

  useEffect(() => {
    const root = window.document.documentElement
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const applyTheme = (currentResolvedTheme: ResolvedTheme) => {
      root.classList.remove('light', 'dark') // Remove existing theme classes
      root.classList.add(currentResolvedTheme) // Add the new theme class
    }

    const handleChange = () => {
      if (theme === 'system') {
        const systemTheme = mediaQuery.matches ? 'dark' : 'light'
        applyTheme(systemTheme)
      }
    }

    applyTheme(resolvedTheme)

    mediaQuery.addEventListener('change', handleChange)

    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme, resolvedTheme])

  const stageTheme = (theme: Theme) => stageThemeCookie(storageKey, theme)
  const applyTheme = (theme: Theme) => {
    _setTheme(theme)
  }
  const setTheme = (theme: Theme) => {
    stageTheme(theme)
    applyTheme(theme)
  }

  const resetTheme = () => {
    removeCookie(storageKey)
    _setTheme(DEFAULT_THEME)
  }

  const contextValue = {
    defaultTheme,
    resolvedTheme,
    resetTheme,
    stageTheme,
    applyTheme,
    theme,
    setTheme,
  }

  return (
    <ThemeContext value={contextValue} {...props}>
      {children}
    </ThemeContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
  const context = useContext(ThemeContext)

  if (!context) throw new Error('useTheme must be used within a ThemeProvider')

  return context
}
