import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import '@/styles/index.css'
import { SearchProvider } from '@/context/search-provider'
import { Search } from '@/components/search'
import { selectAuthorizedNavigationCandidates } from '@/components/layout/data/sidebar-data'
import {
  filterQuickNavigationEntries,
  type QuickNavigationEntry,
} from '@/components/command-menu'
import { setLocale } from '@/lib/i18n'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setTheme: vi.fn(),
  api: vi.fn(),
  switchWorkspace: vi.fn(),
  pathname: '/w/workspace-1/chat',
  actor: null as any,
  directory: null as any,
  detail: null as any,
  navigation: null as any,
  queryConfigs: [] as any[],
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useRouterState: ({ select }: { select: (state: any) => unknown }) =>
      select({ location: { pathname: mocks.pathname } }),
  }
})

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: (options: any) => {
      mocks.queryConfigs.push(options)
      if (options.queryKey[4] === 'workspace-detail') return mocks.detail
      if (options.queryKey[3] === 'tenant-navigation') return mocks.navigation
      return { data: undefined, isSuccess: false, isLoading: true, isFetching: true, isError: false }
    },
  }
})

vi.mock('@/features/workspaces/directory', () => ({
  readRecentWorkspace: (userId: string) => {
    try {
      const value = window.localStorage.getItem(
        'synapse:recent-workspace:' + userId
      )
      return value ? JSON.parse(value) : null
    } catch {
      return null
    }
  },
  useWorkspaceDirectory: () => mocks.directory,
  useWorkspaceSwitch: () => mocks.switchWorkspace,
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: any) => unknown) =>
    selector({ auth: { user: mocks.actor } }),
}))

vi.mock('@/api/workspaces', () => ({
  getWorkspace: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))

vi.mock('@/context/theme-provider', () => ({
  useTheme: () => ({ setTheme: mocks.setTheme }),
}))

const tenant = {
  tenant_id: 'tenant-1',
  name: 'Northwind',
  tenant_role: 'member' as const,
}

// Simulated actor, directory, Workspace detail, and visible-menu API response.
const workspace = {
  workspace_id: 'workspace-1',
  tenant_id: 'tenant-1',
  slug: 'research-team',
  name: 'Research Room',
  icon: null,
  status: 'active' as const,
  workspace_role: 'member' as const,
  membership_version: 17,
}

const visibleMenuResponse = {
  tenant_id: 'tenant-1',
  membership_version: 17,
  items: [
    {
      menu_id: 'menu-1',
      menu_name: '工作区工具',
      path: null,
      icon: null,
      is_frame: 1,
      children: [
        {
          menu_id: 'menu-2',
          menu_name: '自定义入口',
          path: '/w/workspace-1/custom',
          icon: null,
          is_frame: 1,
        },
      ],
    },
  ],
}

function resetMocks() {
  const confirmedTenantQuery = {
    isSuccess: true,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }
  const confirmedWorkspaceQuery = {
    isSuccess: true,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }
  mocks.pathname = '/w/workspace-1/chat'
  mocks.actor = { user_id: 'actor-1', platform_role: 'platform_admin' }
  mocks.directory = {
    actorId: 'actor-1',
    tenants: [tenant],
    tenantById: new Map([[tenant.tenant_id, tenant]]),
    workspaces: [workspace],
    tenantQuery: confirmedTenantQuery,
    workspaceQuery: confirmedWorkspaceQuery,
  }
  mocks.detail = {
    data: workspace,
    isFetched: true,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }
  mocks.navigation = {
    data: visibleMenuResponse,
    isSuccess: true,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }
  mocks.switchWorkspace.mockResolvedValue(true)
  mocks.api.mockResolvedValue(visibleMenuResponse)
  mocks.queryConfigs = []
}

async function renderQuickNavigation() {
  return await render(
    <SearchProvider>
      <Search />
    </SearchProvider>
  )
}

async function openQuickNavigation() {
  await userEvent.keyboard('{Control>}k{/Control}')
  await expect
    .element(
      document.querySelector<HTMLInputElement>(
        '[placeholder="搜索页面或工作空间…"]'
      )
    )
    .toBeInTheDocument()
}

describe('Quick Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setLocale('zh-CN')
    window.localStorage.clear()
    resetMocks()
  })

  it('uses only visible-tree selector candidates and the confirmed actor/workspace version', async () => {
    const screen = await renderQuickNavigation()
    await openQuickNavigation()

    await expect
      .element(screen.getByRole('option', { name: /自定义入口/ }))
      .toBeInTheDocument()
    await userEvent.fill(screen.getByPlaceholder('搜索页面或工作空间…'), '自定义入口')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/w/workspace-1/custom' })

    const navigationQuery = mocks.queryConfigs.find(
      (options) => options.queryKey[3] === 'tenant-navigation'
    )
    expect(navigationQuery.queryKey).toEqual([
      'synapse',
      'actor-1',
      'tenant-1',
      'tenant-navigation',
      'workspace-1',
      17,
    ])
    await navigationQuery.queryFn()
    expect(mocks.api).toHaveBeenCalledWith(
      '/tenants/tenant-1/menus/visible-tree'
    )
  })

  it('preserves the shared selector model and its unresolved-versus-empty contract', () => {
    const scope = {
      verified: true as const,
      actorId: 'actor-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      membershipVersion: 17,
    }
    expect(
      selectAuthorizedNavigationCandidates(visibleMenuResponse, scope)
    ).toEqual([
      expect.objectContaining({
        id: 'menu-2',
        title: '工作区工具 / 自定义入口',
        url: '/w/workspace-1/custom',
        actorId: 'actor-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        membershipVersion: 17,
      }),
    ])
    expect(
      selectAuthorizedNavigationCandidates(
        { ...visibleMenuResponse, items: [] },
        scope
      )
    ).toEqual([])
    expect(
      selectAuthorizedNavigationCandidates(visibleMenuResponse, {
        ...scope,
        tenantId: 'other-tenant',
      })
    ).toBeNull()
  })

  it('hides dynamic results when tenant or membership version does not match', async () => {
    mocks.navigation = {
      ...mocks.navigation,
      data: { ...visibleMenuResponse, membership_version: 18 },
    }
    const screen = await renderQuickNavigation()
    await openQuickNavigation()

    await expect
      .element(screen.getByText('空间导航与当前已确认范围不匹配，已隐藏动态结果。'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('自定义入口'))
      .not.toBeInTheDocument()
    await expect.element(screen.getByText('AI 对话')).toBeInTheDocument()
  })

  it('switches only Workspace entries from the confirmed directory, never recent metadata', async () => {
    window.localStorage.setItem(
      'synapse:recent-workspace:actor-1',
      JSON.stringify({ workspace_id: 'hidden-workspace', name: 'Hidden workspace' })
    )
    const screen = await renderQuickNavigation()
    await openQuickNavigation()

    await expect
      .element(screen.getByRole('option', { name: /Research Room/ }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Hidden workspace'))
      .not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: /Research Room/ }))
    await vi.waitFor(() =>
      expect(mocks.switchWorkspace).toHaveBeenCalledWith('workspace-1')
    )
  })

  it('distinguishes context resolution and dynamic-menu loading from empty results', async () => {
    mocks.navigation = {
      data: undefined,
      isSuccess: false,
      isLoading: true,
      isFetching: true,
      isError: false,
      refetch: vi.fn(),
    }
    const screen = await renderQuickNavigation()
    await openQuickNavigation()
    await expect.element(screen.getByText('正在加载空间导航…')).toBeInTheDocument()
    await expect
      .element(screen.getByText('没有匹配的可访问页面或空间。'))
      .not.toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await expect
      .element(screen.getByPlaceholder('搜索页面或工作空间…'))
      .not.toBeInTheDocument()

    mocks.directory.tenantQuery.isSuccess = false
    mocks.directory.tenantQuery.isLoading = true
    mocks.navigation = {
      data: visibleMenuResponse,
      isSuccess: true,
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    }
    const resolving = await renderQuickNavigation()
    await openQuickNavigation()
    await expect.element(resolving.getByText('正在确认当前空间…')).toBeInTheDocument()
    await expect.element(resolving.getByText('自定义入口')).not.toBeInTheDocument()
  })

  it('preserves fixed navigation during partial errors and provides retry', async () => {
    mocks.navigation = {
      data: undefined,
      isSuccess: false,
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch: vi.fn(),
    }
    const screen = await renderQuickNavigation()
    await openQuickNavigation()

    await expect.element(screen.getByText('AI 对话')).toBeInTheDocument()
    await expect
      .element(screen.getByText('空间导航暂时无法加载，固定导航仍可使用。'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('没有匹配的可访问页面或空间。'))
      .not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(mocks.navigation.refetch).toHaveBeenCalledOnce()
  })

  it('preserves local commands during directory failure and retries the source', async () => {
    mocks.pathname = '/'
    mocks.directory.tenantQuery.isSuccess = false
    mocks.directory.tenantQuery.isError = true
    const screen = await renderQuickNavigation()
    await openQuickNavigation()
    await userEvent.fill(
      screen.getByPlaceholder('搜索页面或工作空间…'),
      '浅色'
    )

    await expect
      .element(screen.getByText('空间目录暂时无法加载，已确认的导航仍可使用。'))
      .toBeInTheDocument()
    await expect.element(screen.getByText('浅色')).toBeInTheDocument()
    await expect
      .element(screen.getByText('没有匹配的可访问页面或空间。'))
      .not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(mocks.directory.tenantQuery.refetch).toHaveBeenCalledOnce()
    expect(mocks.directory.workspaceQuery.refetch).toHaveBeenCalledOnce()
  })

  it('shows verified empty menu and directory states separately', async () => {
    mocks.navigation = {
      ...mocks.navigation,
      data: { ...visibleMenuResponse, items: [] },
    }
    const screen = await renderQuickNavigation()
    await openQuickNavigation()

    await expect.element(screen.getByText('当前空间没有其他导航项。')).toBeInTheDocument()
    await expect
      .element(screen.getByText('当前账号还没有可访问的工作空间。'))
      .not.toBeInTheDocument()
    await expect.element(screen.getByText('AI 对话')).toBeInTheDocument()
  })

  it('shows a verified empty Workspace directory only outside Workspace scope', async () => {
    mocks.pathname = '/'
    mocks.directory.workspaces = []
    const screen = await renderQuickNavigation()
    await openQuickNavigation()

    await expect
      .element(screen.getByText('当前账号还没有可访问的工作空间。'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('当前空间无法在已授权目录中确认。'))
      .not.toBeInTheDocument()
  })

  it('reports a confirmed-but-unavailable Workspace route with directory retry', async () => {
    mocks.directory.workspaces = []
    const screen = await renderQuickNavigation()
    await openQuickNavigation()

    await expect
      .element(screen.getByText('当前空间无法在已授权目录中确认。'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('正在确认当前空间…'))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText('自定义入口'))
      .not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(mocks.directory.tenantQuery.refetch).toHaveBeenCalledOnce()
    expect(mocks.directory.workspaceQuery.refetch).toHaveBeenCalledOnce()
  })

  it('clears query results immediately when the route scope changes', async () => {
    const screen = await renderQuickNavigation()
    await openQuickNavigation()
    await userEvent.fill(
      screen.getByPlaceholder('搜索页面或工作空间…'),
      '自定义入口'
    )
    await expect.element(screen.getByText('自定义入口')).toBeInTheDocument()

    mocks.pathname = '/w/workspace-2/chat'
    mocks.directory.workspaces = [
      workspace,
      { ...workspace, workspace_id: 'workspace-2', name: 'Planning Room' },
    ]
    mocks.detail = {
      data: { ...workspace, workspace_id: 'workspace-2', name: 'Planning Room' },
      isFetched: true,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    }
    mocks.navigation = {
      ...mocks.navigation,
      data: { ...visibleMenuResponse, tenant_id: 'other-tenant' },
    }
    await screen.rerender(
      <SearchProvider>
        <Search />
      </SearchProvider>
    )

    await expect
      .element(screen.getByPlaceholder('搜索页面或工作空间…'))
      .toHaveValue('')
    await expect.element(screen.getByText('自定义入口')).not.toBeInTheDocument()
  })

  it('clears candidates immediately when the actor changes', async () => {
    const screen = await renderQuickNavigation()
    await openQuickNavigation()
    await userEvent.fill(
      screen.getByPlaceholder('搜索页面或工作空间…'),
      '自定义入口'
    )
    await expect.element(screen.getByText('自定义入口')).toBeInTheDocument()

    mocks.actor = { user_id: 'actor-2', platform_role: null }
    mocks.directory.actorId = 'actor-2'
    mocks.directory.tenantQuery.isSuccess = false
    mocks.directory.workspaceQuery.isSuccess = false
    mocks.navigation = {
      data: undefined,
      isSuccess: false,
      isLoading: true,
      isFetching: true,
      isError: false,
      refetch: vi.fn(),
    }
    await screen.rerender(
      <SearchProvider>
        <Search />
      </SearchProvider>
    )

    await expect
      .element(screen.getByPlaceholder('搜索页面或工作空间…'))
      .toHaveValue('')
    await expect.element(screen.getByText('自定义入口')).not.toBeInTheDocument()
  })

  it('matches Chinese substrings and English case-insensitively', () => {
    const entries: QuickNavigationEntry[] = [
      {
        id: 'route:test',
        kind: 'route',
        title: '个人设置',
        aliases: ['Profile Settings'],
        breadcrumbs: ['Personal'],
      },
    ]
    expect(filterQuickNavigationEntries(entries, '设置')).toHaveLength(1)
    expect(filterQuickNavigationEntries(entries, 'profile')).toHaveLength(1)
    expect(filterQuickNavigationEntries(entries, 'HIDDEN_PATH')).toHaveLength(0)
  })

  it('shows a localized no-result state only after successful sources resolve', async () => {
    const screen = await renderQuickNavigation()
    await openQuickNavigation()
    await userEvent.fill(
      screen.getByPlaceholder('搜索页面或工作空间…'),
      'no-such-navigation-target'
    )

    await expect
      .element(screen.getByText('没有匹配的可访问页面或空间。'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '清除搜索' }))
      .toBeVisible()
  })

  it('does not search business content and states that only navigation is searched', async () => {
    const screen = await renderQuickNavigation()
    await openQuickNavigation()

    await expect
      .element(screen.getByText('仅搜索你有权访问的导航，不搜索内容。').last())
      .toBeInTheDocument()
    const queriedKeys = mocks.queryConfigs.map((options) => options.queryKey)
    expect(queriedKeys.some((key) => key[3] === 'tenant-navigation')).toBe(true)
    expect(
      queriedKeys.some((key) =>
        ['chats', 'files', 'users', 'tasks', 'agent-runs'].includes(String(key[4]))
      )
    ).toBe(false)
    expect(mocks.api).not.toHaveBeenCalled()
  })

  it('keeps local theme and language actions separate while localizing navigation', async () => {
    const screen = await renderQuickNavigation()
    await openQuickNavigation()
    await userEvent.fill(screen.getByPlaceholder('搜索页面或工作空间…'), '深色')
    await expect
      .element(screen.getByRole('option', { name: /深色/ }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('没有匹配的可访问页面或空间。'))
      .not.toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(mocks.setTheme).toHaveBeenCalledWith('dark')

    await userEvent.click(screen.getByRole('button', { name: '快速导航' }))
    await userEvent.fill(screen.getByPlaceholder('搜索页面或工作空间…'), '')
    await userEvent.click(screen.getByRole('option', { name: /切换到英文/ }))
    await expect
      .element(screen.getByRole('button', { name: 'Quick navigation' }))
      .toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Quick navigation' }))
    await expect
      .element(screen.getByPlaceholder('Search pages or workspaces…'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Current workspace: Research Room · Northwind'))
      .toBeInTheDocument()
    await userEvent.fill(
      screen.getByPlaceholder('Search pages or workspaces…'),
      '自定义入口'
    )
    await expect
      .element(screen.getByRole('option', { name: /自定义入口/ }))
      .toBeInTheDocument()
  })

  it('fits the dialog inside 320px and 390px browser viewports', async () => {
    const screen = await renderQuickNavigation()
    await openQuickNavigation()

    for (const width of [320, 390]) {
      await page.viewport(width, 844)
      const dialog = document.querySelector<HTMLElement>(
        '[data-quick-navigation][role=dialog]'
      )!
      expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(width)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
      await expect
        .element(screen.getByRole('button', { name: '关闭快速导航' }))
        .toBeVisible()
    }

    await page.viewport(1280, 900)
  })

  it('ignores the shortcut in editable controls, during IME, and behind another dialog', async () => {
    const screen = await renderQuickNavigation()
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })
    )
    await expect
      .element(screen.getByPlaceholder('搜索页面或工作空间…'))
      .not.toBeInTheDocument()
    input.remove()

    const composing = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
    })
    Object.defineProperty(composing, 'isComposing', { value: true })
    document.dispatchEvent(composing)
    await expect
      .element(screen.getByPlaceholder('搜索页面或工作空间…'))
      .not.toBeInTheDocument()

    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('data-state', 'open')
    document.body.append(overlay)
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })
    )
    await expect
      .element(screen.getByPlaceholder('搜索页面或工作空间…'))
      .not.toBeInTheDocument()
    overlay.remove()
  })

  it('supports Home/End selection, route activation, Escape, and trigger focus restoration', async () => {
    const screen = await renderQuickNavigation()
    const trigger = screen.getByRole('button', { name: '快速导航' })
    await userEvent.click(trigger)
    const input = screen.getByPlaceholder('搜索页面或工作空间…')
    await expect.element(input).toBeInTheDocument()

    await userEvent.keyboard('{End}')
    await expect
      .element(screen.getByRole('option').last())
      .toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Home}')
    await expect
      .element(screen.getByRole('option').first())
      .toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Escape}')
    await expect.element(input).not.toBeInTheDocument()
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger.element()))
  })
})
