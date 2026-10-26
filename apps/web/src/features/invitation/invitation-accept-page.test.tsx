import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { ApiProblem, restoreSession, type AuthUser } from '@/lib/api'
import { setLocale } from '@/lib/i18n'
import { InvitationAcceptPageContent } from './invitation-accept-page'

const user: AuthUser = {
  user_id: '7',
  user_name: 'invitee',
  nick_name: null,
  email: 'invitee@example.com',
  phonenumber: null,
  sex: null,
  avatar: null,
  status: 'active',
  platform_role: 'user',
}

const navigate = vi.fn()

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  restoreSession: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => navigate,
    Link: ({
      children,
      to,
      ...rest
    }: {
      children?: React.ReactNode
      to: string
    }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  setLocale('zh-CN')
  useAuthStore.getState().auth.reset()
})

afterEach(() => setLocale('zh-CN'))

describe('InvitationAcceptPage session states', () => {
  it('shows the accept action after restoring a cookie session', async () => {
    vi.mocked(restoreSession).mockImplementation(async () => {
      useAuthStore.getState().auth.setUser(user)
      return user
    })

    const screen = await render(
      <InvitationAcceptPageContent token='valid-token' />
    )

    await expect
      .element(screen.getByText('已登录。请确认这是接受此邀请的账号。'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '接受租户邀请' }))
      .toBeEnabled()
  })

  it('shows login and registration choices for a 401 session probe', async () => {
    vi.mocked(restoreSession).mockRejectedValue(
      new ApiProblem(401, 'AUTHENTICATION_REQUIRED', 'Unauthorized')
    )

    const screen = await render(
      <InvitationAcceptPageContent token='valid-token' />
    )

    await expect
      .element(screen.getByRole('button', { name: '已有账号，登录' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '没有账号，创建账号' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '登录并继续' }))
      .toBeEnabled()
  })

  it('offers a successful retry after a network failure', async () => {
    vi.mocked(restoreSession)
      .mockRejectedValueOnce(new ApiProblem(0, 'NETWORK_ERROR', 'Offline'))
      .mockImplementationOnce(async () => {
        useAuthStore.getState().auth.setUser(user)
        return user
      })

    const screen = await render(
      <InvitationAcceptPageContent token='valid-token' />
    )
    const retry = screen.getByRole('button', { name: '重新检查' })

    await expect.element(retry).toBeInTheDocument()
    await userEvent.click(retry)

    await expect
      .element(screen.getByRole('button', { name: '接受租户邀请' }))
      .toBeEnabled()
    expect(restoreSession).toHaveBeenCalledTimes(2)
  })
})
