import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { AuthUser } from '@/lib/api'
import { fonts } from '@/config/fonts'
import { FontProvider, useFont } from '@/context/font-provider'
import { ThemeProvider, useTheme } from '@/context/theme-provider'
import { clearCookies } from '@/test-utils/cookies'
import { setLocale } from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import * as cookieUtils from '@/lib/cookies'
import { SettingsDisplay } from './display'
import { SettingsNotifications } from './notifications'
import { AppearanceForm } from './appearance/appearance-form'
import { SettingsAccount } from './account'
import { AccountForm } from './account/account-form'
import { ProfileForm } from './profile/profile-form'
import { clearProfileDraft } from './profile/profile-draft'

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
vi.mock('@/lib/cookies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cookies')>()
  return {
    ...actual,
    getCookie: vi.fn(actual.getCookie),
    setCookie: vi.fn(actual.setCookie),
  }
})
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: () => navigateMock }
})

const originalGetCookie = vi.mocked(cookieUtils.getCookie).getMockImplementation()!
const originalSetCookie = vi.mocked(cookieUtils.setCookie).getMockImplementation()!

const user: AuthUser = {
  user_id: 'user-1',
  user_name: 'sample-user',
  nick_name: 'Sample User',
  email: null,
  phonenumber: null,
  sex: null,
  avatar: null,
  status: 'active',
  platform_role: 'user',
}

function AppearanceProviderStateProbe() {
  const { theme } = useTheme()
  const { font } = useFont()

  return (
    <output data-testid='appearance-provider-state' data-theme={theme} data-font={font}>
      {`${theme}:${font}`}
    </output>
  )
}

describe('settings realism', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(cookieUtils.getCookie).mockReset().mockImplementation(originalGetCookie)
    vi.mocked(cookieUtils.setCookie).mockReset().mockImplementation(originalSetCookie)
    clearCookies()
    clearProfileDraft()
    setLocale('en')
    document.documentElement.classList.remove('light', 'dark')
    useAuthStore.getState().auth.reset()
    vi.mocked(api).mockReset()
    vi.mocked(toast.success).mockReset()
    navigateMock.mockReset()
  })

  it.each([
    ['display', SettingsDisplay, /Sidebar display preferences do not have a read or save API yet/i],
    ['notifications', SettingsNotifications, /Notification preferences do not have read, save, or real delivery channels yet/i],
  ])('keeps %s read-only without template values or submission', async (_name, Component, reason) => {
    const screen = await render(<Component />)

    await expect.element(screen.getByRole('status')).toHaveTextContent(reason)
    await expect.element(screen.getByRole('button', { name: /temporarily unavailable/i })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: /temporarily unavailable/i })).toHaveAttribute('aria-describedby')
    expect(api).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each([
    [SettingsDisplay, /侧栏显示偏好尚未接入读取和保存 API/],
    [SettingsNotifications, /通知偏好尚未接入读取、保存和真实投递渠道/],
  ])('shows the unavailable reason in Chinese', async (Component, reason) => {
    setLocale('zh-CN')
    const screen = await render(<Component />)

    await expect.element(screen.getByRole('status')).toHaveTextContent('暂不可用')
    await expect.element(screen.getByRole('status')).toHaveTextContent(reason)
  })

  it('supports the provider system theme and persists appearance only in browser cookies', async () => {
    const onSaved = vi.fn()
    const screen = await render(
      <ThemeProvider>
        <FontProvider>
          <>
            <AppearanceProviderStateProbe />
            <AppearanceForm onSaved={onSaved} />
          </>
        </FontProvider>
      </ThemeProvider>
    )
    const providerState = screen.getByTestId('appearance-provider-state')
    const initialClasses = [...document.documentElement.classList]
    await expect.element(providerState).toHaveAttribute('data-theme', 'system')
    await expect.element(providerState).toHaveAttribute('data-font', fonts[0])

    for (const theme of ['System', 'Light', 'Dark']) {
      await expect.element(screen.getByRole('radio', { name: theme })).toBeInTheDocument()
    }
    for (const font of fonts) {
      await expect.element(screen.getByRole('option', { name: font })).toBeInTheDocument()
    }
    vi.mocked(cookieUtils.setCookie).mockImplementation((name, value, maxAge) => {
      originalSetCookie(name, value, maxAge)
      if (name === 'vite-ui-theme' || name === 'font') {
        const state = document.querySelector('[data-testid="appearance-provider-state"]')
        expect(state?.getAttribute('data-theme')).toBe('system')
        expect(state?.getAttribute('data-font')).toBe(fonts[0])
        expect([...document.documentElement.classList]).toEqual(initialClasses)
      }
    })
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    await userEvent.selectOptions(screen.getByRole('combobox'), fonts[1])
    await userEvent.click(screen.getByRole('button', { name: /apply for this browser/i }))

    await expect.element(providerState).toHaveAttribute('data-theme', 'dark')
    await expect.element(providerState).toHaveAttribute('data-font', fonts[1])
    expect(document.documentElement.classList).toContain('dark')
    expect(document.documentElement.classList).toContain(`font-${fonts[1]}`)
    expect(document.documentElement.classList).not.toContain('light')
    expect(document.documentElement.classList).not.toContain(`font-${fonts[0]}`)
    expect(document.cookie).toContain(['vite-ui', 'theme=dark'].join('-'))
    expect(cookieUtils.getCookie('font')).toBe(fonts[1])
    expect(api).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Appearance applied in this browser only.')
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('rolls back verified appearance changes after a silent Cookie write refusal', async () => {
    const onSaved = vi.fn()
    const screen = await render(
      <ThemeProvider>
        <FontProvider>
          <>
            <AppearanceProviderStateProbe />
            <AppearanceForm onSaved={onSaved} />
          </>
        </FontProvider>
      </ThemeProvider>
    )
    const providerState = screen.getByTestId('appearance-provider-state')
    vi.mocked(cookieUtils.setCookie).mockImplementation((name, value, maxAge) => {
      if (name === 'font') return
      originalSetCookie(name, value, maxAge)
    })

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    await userEvent.selectOptions(screen.getByRole('combobox'), fonts[1])
    await userEvent.click(screen.getByRole('button', { name: /apply for this browser/i }))

    await expect.element(screen.getByRole('alert')).toHaveTextContent('Appearance was not applied')
    await expect.element(screen.getByRole('alert')).toHaveTextContent('theme cookie restored to its previous value')
    await expect.element(screen.getByRole('alert')).toHaveTextContent('font cookie restored to its previous value')
    await expect.element(screen.getByRole('button', { name: /apply for this browser/i })).toBeEnabled()
    expect(document.querySelector('form')?.getAttribute('aria-busy')).toBe('false')
    await expect.element(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
    await expect.element(screen.getByRole('combobox')).toHaveValue(fonts[1])
    await expect.element(providerState).toHaveAttribute('data-theme', 'system')
    await expect.element(providerState).toHaveAttribute('data-font', fonts[0])
    expect(document.documentElement.classList).toContain(`font-${fonts[0]}`)
    expect(cookieUtils.getCookie('vite-ui-theme')).toBeUndefined()
    expect(cookieUtils.getCookie('font')).toBeUndefined()
    expect(toast.success).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('reports an unconfirmed cookie when rollback readback fails', async () => {
    const onSaved = vi.fn()
    const screen = await render(
      <ThemeProvider>
        <FontProvider>
          <>
            <AppearanceProviderStateProbe />
            <AppearanceForm onSaved={onSaved} />
          </>
        </FontProvider>
      </ThemeProvider>
    )
    let themeReads = 0
    vi.mocked(cookieUtils.getCookie).mockImplementation((name) => {
      if (name === 'vite-ui-theme') {
        themeReads += 1
        if (themeReads === 3) throw new Error('Cookie readback blocked during rollback')
      }
      return originalGetCookie(name)
    })
    vi.mocked(cookieUtils.setCookie).mockImplementation((name, value, maxAge) => {
      if (name === 'font') return
      originalSetCookie(name, value, maxAge)
    })

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    await userEvent.selectOptions(screen.getByRole('combobox'), fonts[1])
    await userEvent.click(screen.getByRole('button', { name: /apply for this browser/i }))

    await expect.element(screen.getByRole('alert')).toHaveTextContent('Partial result')
    await expect.element(screen.getByRole('alert')).toHaveTextContent('theme cookie unconfirmed; it may retain the selected value')
    await expect.element(screen.getByRole('alert')).toHaveTextContent('font cookie restored to its previous value')
    await expect.element(screen.getByRole('button', { name: /apply for this browser/i })).toBeEnabled()
    expect(document.querySelector('form')?.getAttribute('aria-busy')).toBe('false')
    await expect.element(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
    await expect.element(screen.getByRole('combobox')).toHaveValue(fonts[1])
    await expect.element(screen.getByTestId('appearance-provider-state')).toHaveTextContent(`system:${fonts[0]}`)
    expect(toast.success).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('retains the draft and rolls back both cookies after post-stage readback throws', async () => {
    const onSaved = vi.fn()
    const screen = await render(
      <ThemeProvider>
        <FontProvider>
          <>
            <AppearanceProviderStateProbe />
            <AppearanceForm onSaved={onSaved} />
          </>
        </FontProvider>
      </ThemeProvider>
    )
    let fontReads = 0
    vi.mocked(cookieUtils.getCookie).mockImplementation((name) => {
      if (name === 'font') {
        fontReads += 1
        if (fontReads === 3) throw new Error('Post-stage font readback failed')
      }
      return originalGetCookie(name)
    })

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    await userEvent.selectOptions(screen.getByRole('combobox'), fonts[1])
    await userEvent.click(screen.getByRole('button', { name: /apply for this browser/i }))

    await expect.element(screen.getByRole('alert')).toHaveTextContent('Appearance was not applied')
    await expect.element(screen.getByRole('alert')).toHaveTextContent('theme cookie restored to its previous value')
    await expect.element(screen.getByRole('alert')).toHaveTextContent('font cookie restored to its previous value')
    expect(document.querySelector('form')?.getAttribute('aria-busy')).toBe('false')
    await expect.element(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
    await expect.element(screen.getByRole('combobox')).toHaveValue(fonts[1])
    await expect.element(screen.getByTestId('appearance-provider-state')).toHaveTextContent(`system:${fonts[0]}`)
    expect(cookieUtils.getCookie('vite-ui-theme')).toBeUndefined()
    expect(cookieUtils.getCookie('font')).toBeUndefined()
    expect(document.documentElement.classList).not.toContain('dark')
    expect(document.documentElement.classList).toContain(`font-${fonts[0]}`)
    expect(toast.success).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it.each([
    ['Cookie write', 'setCookie'],
    ['Cookie read', 'getCookie'],
  ] as const)('leaves appearance saving state after a thrown %s access', async (_name, method) => {
    const onSaved = vi.fn()
    const screen = await render(
      <ThemeProvider>
        <FontProvider>
          <AppearanceForm onSaved={onSaved} />
        </FontProvider>
      </ThemeProvider>
    )
    if (method === 'setCookie') {
      vi.mocked(cookieUtils.setCookie).mockImplementation(() => {
        throw new Error('Cookie write blocked')
      })
    } else {
      vi.mocked(cookieUtils.getCookie).mockImplementation((name) => {
        if (name === 'vite-ui-theme') throw new Error('Cookie read blocked')
        return originalGetCookie(name)
      })
    }

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    await userEvent.click(screen.getByRole('button', { name: /apply for this browser/i }))

    await expect.element(screen.getByRole('alert')).toHaveTextContent('The browser could not confirm the appearance cookie.')
    await expect.element(screen.getByRole('button', { name: /apply for this browser/i })).toBeEnabled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('shows loaded profile values and updates the current account from the API response', async () => {
    useAuthStore.getState().auth.setUser(user)
    const savedUser = { ...user, nick_name: 'Updated User' }
    vi.mocked(api).mockResolvedValue(savedUser)
    const onSaved = vi.fn()
    const screen = await render(<ProfileForm onSaved={onSaved} />)

    await expect.element(screen.getByLabelText('Display name')).toHaveValue('Sample User')
    await expect.element(screen.getByLabelText('Email')).toHaveValue('')
    await userEvent.fill(screen.getByLabelText('Display name'), 'Updated User')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(api).toHaveBeenCalledWith('/account/profile', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        nick_name: 'Updated User',
        email: null,
        phonenumber: null,
        sex: null,
        avatar: null,
      }),
    }))
    expect(useAuthStore.getState().auth.user).toEqual(savedUser)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('keeps the profile draft visible after an API failure', async () => {
    useAuthStore.getState().auth.setUser(user)
    vi.mocked(api).mockRejectedValue(new Error('Profile update rejected'))
    const onSaved = vi.fn()
    const screen = await render(<ProfileForm onSaved={onSaved} />)

    await userEvent.fill(screen.getByLabelText('Display name'), 'Unsaved draft')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await expect.element(screen.getByRole('alert')).toHaveTextContent('Profile update rejected')
    await expect.element(screen.getByLabelText('Display name')).toHaveValue('Unsaved draft')
    expect(onSaved).not.toHaveBeenCalled()
    expect(useAuthStore.getState().auth.user).toEqual(user)
  })

  it('retains a 401-reset profile draft in memory and never exposes it to another account', async () => {
    useAuthStore.getState().auth.setUser(user)
    vi.mocked(api).mockImplementation(async () => {
      useAuthStore.getState().auth.reset()
      throw new Error('Unauthorized')
    })
    const onSaved = vi.fn()
    const screen = await render(<ProfileForm onSaved={onSaved} />)

    await userEvent.fill(screen.getByLabelText('Display name'), 'Unsaved account A draft')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await expect.element(screen.getByRole('alert')).toHaveTextContent('The current account is not loaded. Reload the page and try again.')
    await expect.element(screen.getByLabelText('Display name')).toHaveValue('Unsaved account A draft')
    await expect.element(screen.getByLabelText('Display name')).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled()
    expect(api).toHaveBeenCalledTimes(1)
    expect(toast.success).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()

    await screen.unmount()
    const remountedScreen = await render(<ProfileForm onSaved={onSaved} />)
    await expect.element(remountedScreen.getByLabelText('Display name')).toHaveValue('Unsaved account A draft')
    await expect.element(remountedScreen.getByLabelText('Display name')).toBeDisabled()

    const accountB = { ...user, user_id: 'user-2', user_name: 'account-b', nick_name: 'Account B' }
    useAuthStore.getState().auth.setUser(accountB)

    await expect.element(remountedScreen.getByLabelText('Display name')).toHaveValue('Account B')
    expect(remountedScreen.getByLabelText('Display name')).not.toHaveValue('Unsaved account A draft')
  })

  it('clears the in-memory profile draft after an explicit reset', async () => {
    useAuthStore.getState().auth.setUser(user)
    const screen = await render(<ProfileForm />)

    await userEvent.fill(screen.getByLabelText('Display name'), 'Discard this draft')
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))

    await expect.element(screen.getByLabelText('Display name')).toHaveValue('Sample User')
    await screen.unmount()
    const remountedScreen = await render(<ProfileForm />)
    await expect.element(remountedScreen.getByLabelText('Display name')).toHaveValue('Sample User')
  })

  it('keeps the current session and reports password API failures without success feedback', async () => {
    useAuthStore.getState().auth.setUser(user)
    vi.mocked(api).mockRejectedValue(new Error('Password update rejected'))
    const screen = await render(<AccountForm />)

    await userEvent.fill(screen.getByLabelText('Current password'), 'old-password')
    await userEvent.fill(screen.getByLabelText('New password'), 'new-password-long')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await expect.element(screen.getByRole('alert')).toHaveTextContent('Password update rejected')
    expect(useAuthStore.getState().auth.user).toEqual(user)
    expect(toast.success).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('does not offer password changes until the current account is loaded', async () => {
    const screen = await render(<SettingsAccount />)

    await expect.element(screen.getByRole('alert')).toHaveTextContent('Account values cannot be confirmed')
    await expect.element(screen.getByRole('button', { name: /Change password/i })).toBeDisabled()
  })
})
