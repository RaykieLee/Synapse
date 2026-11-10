import { createContext, useContext, useEffect, useState } from 'react'
import { fonts } from '@/config/fonts'
import { getCookie, setCookie, removeCookie } from '@/lib/cookies'

type Font = (typeof fonts)[number]

const FONT_COOKIE_NAME = 'font'
const FONT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

type FontCookieStage = { rollback: () => boolean }
type FontCookieFailure = Error & {
  cause?: unknown
  rollbackConfirmed: boolean
  writeAttempted: boolean
}

function readFontCookie(): Font | undefined {
  try {
    const savedFont = getCookie(FONT_COOKIE_NAME)
    return fonts.includes(savedFont as Font) ? (savedFont as Font) : undefined
  } catch {
    return undefined
  }
}

function restoreFontCookie(font: string | undefined) {
  try {
    if (font === undefined) removeCookie(FONT_COOKIE_NAME)
    else setCookie(FONT_COOKIE_NAME, font, FONT_COOKIE_MAX_AGE)
    return getCookie(FONT_COOKIE_NAME) === font
  } catch {
    return false
  }
}

function stageFontCookie(font: Font): FontCookieStage {
  let previousFont: string | undefined
  let writeAttempted = false

  try {
    previousFont = getCookie(FONT_COOKIE_NAME)
    writeAttempted = true
    setCookie(FONT_COOKIE_NAME, font, FONT_COOKIE_MAX_AGE)
    if (getCookie(FONT_COOKIE_NAME) !== font) {
      throw new Error('Font cookie write was not confirmed.')
    }
  } catch (cause) {
    const rollbackConfirmed = writeAttempted
      ? restoreFontCookie(previousFont)
      : false
    const failure = new Error(
      'Font cookie write could not be confirmed.'
    ) as FontCookieFailure
    Object.assign(failure, { cause, rollbackConfirmed, writeAttempted })
    throw failure
  }

  return { rollback: () => restoreFontCookie(previousFont) }
}

type FontContextType = {
  font: Font
  setFont: (font: Font) => void
  stageFont: (font: Font) => FontCookieStage
  applyFont: (font: Font) => void
  resetFont: () => void
}

const FontContext = createContext<FontContextType | null>(null)

export function FontProvider({ children }: { children: React.ReactNode }) {
  const [font, _setFont] = useState<Font>(() => {
    return readFontCookie() || fonts[0]
  })

  useEffect(() => {
    const applyFont = (font: string) => {
      const root = document.documentElement
      root.classList.forEach((cls) => {
        if (cls.startsWith('font-')) root.classList.remove(cls)
      })
      root.classList.add(`font-${font}`)
    }

    applyFont(font)
  }, [font])

  const stageFont = (font: Font) => stageFontCookie(font)
  const applyFont = (font: Font) => {
    _setFont(font)
  }
  const setFont = (font: Font) => {
    stageFont(font)
    applyFont(font)
  }

  const resetFont = () => {
    removeCookie(FONT_COOKIE_NAME)
    _setFont(fonts[0])
  }

  return (
    <FontContext value={{ font, setFont, stageFont, applyFont, resetFont }}>
      {children}
    </FontContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useFont = () => {
  const context = useContext(FontContext)
  if (!context) {
    throw new Error('useFont must be used within a FontProvider')
  }
  return context
}
