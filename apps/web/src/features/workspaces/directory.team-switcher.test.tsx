import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import '@/styles/index.css'
import { ApiProblem } from '@/lib/api'
import { TeamSwitcher } from './directory'
import { setLocale } from '@/lib/i18n'

const mocks = vi.hoisted(() => ({
  actor: { user_id: 'actor-1' },
  isMobile: true,
  pathname: '/w/workspace-old/chat',
  navigate: vi.fn(async (_destination: { to: string }) => undefined),
  setOpenMobile: vi.fn(),
  tenantQuery: null as any,
  workspaceQuery: null as any,
  removeQueries: vi.fn(),
  invalidateQueries: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: ({ select }: { select: (state: any) => unknown }) =>
    select({ location: { pathname: mocks.pathname } }),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: (options: any) =>
    options.queryKey[4] === 'tenant-directory'
      ? mocks.tenantQuery
      : mocks.workspaceQuery,
  useQueryClient: () => ({
    removeQueries: mocks.removeQueries,
    invalidateQueries: mocks.invalidateQueries,
  }),
}))

vi.mock('@/stores/auth-store', () => {
  const useAuthStore: any = (selector: (state: any) => unknown) =>
    selector({ auth: { user: mocks.actor } })
  useAuthStore.getState = () => ({ auth: { user: mocks.actor } })
  return { useAuthStore }
})

vi.mock('@/components/ui/sidebar', async () => {
  const React = await import('react')
  const passthrough = (tag: 'div' | 'li') =>
    React.forwardRef<HTMLElement, any>(({ children, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children)
    )
  const SidebarMenuButton = React.forwardRef<HTMLButtonElement, any>(
    ({ size: _size, children, ...props }, ref) =>
      React.createElement('button', { ...props, ref, type: 'button' }, children)
  )
  return {
    SidebarMenu: passthrough('div'),
    SidebarMenuItem: passthrough('li'),
    SidebarMenuButton,
    useSidebar: () => ({
      isMobile: mocks.isMobile,
      setOpenMobile: mocks.setOpenMobile,
    }),
  }
})

const tenant = {
  tenant_id: 'tenant-1',
  name: 'Northwind tenant',
  tenant_role: 'member' as const,
}

const workspace = {
  workspace_id: 'workspace-current',
  tenant_id: tenant.tenant_id,
  slug: 'field-operations',
  name: 'Field Operations workspace with a deliberately long descriptive name',
  icon: null,
  status: 'active' as const,
  workspace_role: 'member' as const,
  membership_version: 7,
}

function successfulDirectory() {
  return {
    data: { items: [tenant] },
    isSuccess: true,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }
}

function successfulWorkspaces(items = [workspace]) {
  return {
    data: { items },
    isSuccess: true,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }
}

function resetFixtures() {
  mocks.actor = { user_id: 'actor-1' }
  mocks.isMobile = true
  mocks.pathname = '/w/workspace-old/chat'
  mocks.navigate = vi.fn(async (_destination: { to: string }) => undefined)
  mocks.setOpenMobile = vi.fn()
  mocks.tenantQuery = successfulDirectory()
  mocks.workspaceQuery = successfulWorkspaces()
  mocks.removeQueries = vi.fn()
  mocks.invalidateQueries = vi.fn()
  window.localStorage.clear()
  setLocale('en')
}

async function openMobileSwitcher() {
  const screen = await render(<TeamSwitcher />)
  await userEvent.click(screen.getByRole('button', { name: 'Select Workspace' }))
  return screen
}

describe('mobile Workspace switcher', () => {
  beforeEach(() => resetFixtures())

  it.each([320, 390])('uses a viewport-wide dialog at %ipx', async (width) => {
    await page.viewport(width, 844)
    const screen = await openMobileSwitcher()
    const dialog = screen.getByRole('dialog')

    await expect.element(dialog).toBeVisible()
    await new Promise((resolve) => window.setTimeout(resolve, 250))
    expect(dialog.element().getBoundingClientRect().width).toBe(width)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    await expect
      .element(screen.getByRole('combobox', { name: 'Search Workspaces or tenants…' }))
      .toBeVisible()
  })

  it('keeps long names readable and routes, closes the drawer, and moves focus after selection', async () => {
    await page.viewport(390, 844)
    const destination = document.createElement('span')
    destination.id = 'route-destination'
    destination.tabIndex = -1
    document.body.append(destination)
    const screen = await openMobileSwitcher()
    const option = screen.getByRole('option', {
      name: /Field Operations workspace with a deliberately long descriptive name/,
    })

    await expect.element(option).toBeVisible()
    expect(option.element().textContent).toContain(workspace.name)
    await userEvent.click(option)
    await new Promise((resolve) => window.requestAnimationFrame(resolve))

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/w/workspace-current' })
    expect(mocks.setOpenMobile).toHaveBeenCalledWith(false)
    expect(document.activeElement).toBe(destination)
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    destination.remove()
  })

  it('supports keyboard selection and restores focus to the route destination', async () => {
    await page.viewport(390, 844)
    const destination = document.createElement('span')
    destination.id = 'route-destination'
    destination.tabIndex = -1
    document.body.append(destination)
    const screen = await openMobileSwitcher()
    const input = screen.getByRole('combobox', {
      name: 'Search Workspaces or tenants…',
    })

    await expect.element(input).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await new Promise((resolve) => window.requestAnimationFrame(resolve))

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/w/workspace-current' })
    expect(document.activeElement).toBe(destination)
    destination.remove()
  })

  it('localizes switcher hints and input text in Chinese and English', async () => {
    await page.viewport(390, 844)
    setLocale('zh-CN')
    let screen = await render(<TeamSwitcher />)
    await userEvent.click(screen.getByRole('button', { name: '选择 Workspace' }))
    await expect
      .element(screen.getByRole('heading', { name: '切换 Workspace' }))
      .toBeVisible()
    await expect
      .element(
        screen
          .getByRole('dialog')
          .getByText('仅显示已确认可访问的 Workspace')
      )
      .toBeVisible()
    const chineseSearch = screen.getByRole('combobox', {
      name: '搜索 Workspace 或租户…',
    })
    await expect.element(chineseSearch).toBeVisible()
    expect(chineseSearch.element().getAttribute('placeholder')).toBe(
      '搜索 Workspace 或租户…'
    )

    await userEvent.keyboard('{Escape}')
    setLocale('en')
    await screen.rerender(<TeamSwitcher />)
    await userEvent.click(screen.getByRole('button', { name: 'Select Workspace' }))
    await expect
      .element(screen.getByRole('heading', { name: 'Switch Workspace' }))
      .toBeVisible()
    await expect
      .element(
        screen
          .getByRole('dialog')
          .getByText('Only Workspaces confirmed as accessible are shown.')
      )
      .toBeVisible()
    const englishSearch = screen.getByRole('combobox', {
      name: 'Search Workspaces or tenants…',
    })
    await expect.element(englishSearch).toBeVisible()
    expect(englishSearch.element().getAttribute('placeholder')).toBe(
      'Search Workspaces or tenants…'
    )
  })

  it('shows an explicit empty state', async () => {
    mocks.workspaceQuery = successfulWorkspaces([])
    const screen = await openMobileSwitcher()

    await expect
      .element(screen.getByText('No accessible Workspaces match.'))
      .toBeVisible()
  })

  it('hides retained directory data after a failed refetch and offers recovery', async () => {
    mocks.workspaceQuery = successfulWorkspaces()
    const screen = await openMobileSwitcher()
    await expect
      .element(
        screen.getByRole('option', {
          name: /Field Operations workspace with a deliberately long descriptive name/,
        })
      )
      .toBeVisible()

    mocks.workspaceQuery = {
      ...successfulWorkspaces(),
      isError: true,
      error: new Error('revoked'),
      refetch: vi.fn(),
    }
    await screen.rerender(<TeamSwitcher />)

    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Could not load the accessible Workspace directory.')
    await expect
      .element(
        screen.getByRole('option', {
          name: /Field Operations workspace with a deliberately long descriptive name/,
        })
      )
      .not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reload directory' }))
    expect(mocks.tenantQuery.refetch).toHaveBeenCalledOnce()
    expect(mocks.workspaceQuery.refetch).toHaveBeenCalledOnce()
  })

  it.each([
    [new ApiProblem(403, 'WORKSPACE_MEMBERSHIP_REQUIRED'), 'You cannot access this Workspace right now.'],
    [new ApiProblem(400, 'CONTEXT_MISMATCH'), 'Workspace context could not be confirmed. No Workspace content was loaded.'],
  ])('shows recovery copy for authorization/context errors', async (error, message) => {
    mocks.workspaceQuery = {
      ...successfulWorkspaces(),
      isError: true,
      error,
      refetch: vi.fn(),
    }
    const screen = await openMobileSwitcher()

    await expect.element(screen.getByRole('alert')).toHaveTextContent(message)
    await expect
      .element(
        screen.getByRole('option', {
          name: /Field Operations workspace with a deliberately long descriptive name/,
        })
      )
      .not.toBeInTheDocument()
  })
})
