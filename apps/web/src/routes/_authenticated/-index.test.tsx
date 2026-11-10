import type { ComponentProps, ComponentType, ReactNode } from 'react'
import '@/styles/index.css'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { setLocale } from '@/lib/i18n'
import type { TenantSummary, Workspace } from '@/features/workspaces/types'
import { AuthenticatedHome } from './index'

const {
  baseTenantById,
  baseTenants,
  baseWorkspaces,
  directory,
  navigate,
  recentWorkspace,
  saveRecentWorkspace,
} = vi.hoisted(() => {
  const active: Workspace = {
    workspace_id: 'workspace-active',
    tenant_id: 'tenant-a',
    name: 'Active Workspace',
    slug: 'active',
    icon: null,
    status: 'active',
    workspace_role: 'member',
  }
  const archived: Workspace = {
    workspace_id: 'workspace-archived',
    tenant_id: 'tenant-b',
    name: 'Archived Workspace',
    slug: 'archived',
    icon: null,
    status: 'archived',
    workspace_role: 'admin',
  }
  const tenantA: TenantSummary = {
    tenant_id: 'tenant-a',
    name: 'Tenant A',
    tenant_role: 'member',
  }
  const tenantB: TenantSummary = {
    tenant_id: 'tenant-b',
    name: 'Tenant B',
    tenant_role: 'admin',
  }
  const initialTenants = [tenantA, tenantB]
  const initialTenantById = new Map([
    [tenantA.tenant_id, tenantA],
    [tenantB.tenant_id, tenantB],
  ])
  const query = () => ({
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(),
  })
  const initialWorkspaces = [active, archived]
  return {
    baseTenantById: initialTenantById,
    baseTenants: initialTenants,
    baseWorkspaces: initialWorkspaces,
    navigate: vi.fn(),
    saveRecentWorkspace: vi.fn(),
    recentWorkspace: { current: null as Workspace | null },
    directory: {
      actorId: 'actor-a',
      tenants: initialTenants,
      tenantById: new Map(initialTenantById),
      workspaces: initialWorkspaces,
      tenantQuery: query(),
      workspaceQuery: query(),
    },
  }
})

vi.mock('@/features/workspaces/directory', () => ({
  useWorkspaceDirectory: () => directory,
  readRecentWorkspace: () => recentWorkspace.current,
  saveRecentWorkspace,
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: <T,>(
    selector: (state: { auth: { user: { user_id: string } } }) => T
  ) => selector({ auth: { user: { user_id: 'actor-a' } } }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    onClick,
    ...props
  }: { to: string; children: ReactNode } & ComponentProps<'a'>) => (
    <a
      href={String(to)}
      {...props}
      onClick={(event) => {
        event.preventDefault()
        onClick?.(event)
      }}
    >
      {children}
    </a>
  ),
  useNavigate: () => navigate,
  createFileRoute: () => (options: { component: ComponentType }) => options,
}))

function setDirectoryState({
  tenantError = false,
  workspaceError = false,
  pending = false,
  workspaces = baseWorkspaces,
}: {
  tenantError?: boolean
  workspaceError?: boolean
  pending?: boolean
  workspaces?: Workspace[]
} = {}) {
  directory.workspaces = workspaces
  directory.tenantQuery = {
    isPending: pending,
    isError: tenantError,
    isSuccess: !pending && !tenantError,
    isFetching: false,
    refetch: vi.fn(),
  }
  directory.workspaceQuery = {
    isPending: pending,
    isError: workspaceError,
    isSuccess: !pending && !workspaceError,
    isFetching: false,
    refetch: vi.fn(),
  }
}

describe('authenticated workspace workbench', () => {
  beforeEach(async () => {
    setLocale('zh-CN')
    directory.tenants = [...baseTenants]
    directory.tenantById = new Map(baseTenantById)
    recentWorkspace.current = null
    navigate.mockClear()
    saveRecentWorkspace.mockClear()
    setDirectoryState()
    await page.viewport(1280, 900)
  })

  afterEach(async () => {
    await cleanup()
    setLocale('zh-CN')
  })

  it('stays on the workbench until a workspace is explicitly opened', async () => {
    render(<AuthenticatedHome />)

    await expect
      .element(page.getByRole('heading', { name: '工作台' }))
      .toBeVisible()
    expect(navigate).not.toHaveBeenCalled()
    await expect
      .element(page.getByRole('heading', { name: '租户：Tenant A' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('heading', { name: '租户：Tenant B' }))
      .toBeVisible()
  })

  it('shows active and archived sections and records explicit entry', async () => {
    render(<AuthenticatedHome />)

    await expect
      .element(page.getByRole('heading', { name: '活动 Workspace' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('heading', { name: '已归档 Workspace' }))
      .toBeVisible()
    await expect
      .element(
        page.getByText(
          '已归档 Workspace 不会自动进入；请显式选择“进入 Workspace”。'
        )
      )
      .toBeVisible()

    await page.getByRole('link', { name: '进入 Workspace' }).first().click()
    expect(saveRecentWorkspace).toHaveBeenCalledWith(
      'actor-a',
      directory.workspaces[0]
    )
    expect(navigate).toHaveBeenCalledWith({ to: '/w/workspace-active' })
  })

  it('shows a successful empty directory as an empty state', async () => {
    setDirectoryState({ workspaces: [] })
    render(<AuthenticatedHome />)
    await expect
      .element(page.getByText('当前账号没有可访问的 Workspace'))
      .toBeVisible()
    await expect
      .element(page.getByText('无法加载 Workspace 目录'))
      .not.toBeInTheDocument()
  })

  it('shows a directory failure separately from an empty state and allows retry', async () => {
    setDirectoryState({ tenantError: true, workspaces: [] })
    render(<AuthenticatedHome />)
    await expect.element(page.getByRole('alert')).toBeVisible()
    await expect
      .element(page.getByText('当前账号没有可访问的 Workspace'))
      .not.toBeInTheDocument()
    await page.getByRole('button', { name: '重试租户目录' }).click()
    expect(directory.tenantQuery.refetch).toHaveBeenCalledOnce()
  })

  it('keeps active and archived workspace results when tenant loading fails', async () => {
    setDirectoryState({ tenantError: true })
    directory.tenants = []
    directory.tenantById = new Map()
    recentWorkspace.current = directory.workspaces[0]

    render(<AuthenticatedHome />)

    await expect.element(page.getByRole('alert')).toBeVisible()
    await expect.element(page.getByText('无法加载租户目录')).toBeVisible()
    await expect
      .element(
        page.getByText(
          '仅展示成功加载的目录数据；失败的目录不作为权限或“无 Workspace”依据。请重试失败项。'
        )
      )
      .toBeVisible()
    await expect
      .element(page.getByRole('button', { name: '重试租户目录' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('button', { name: '重试 Workspace 目录' }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('heading', { name: '活动 Workspace' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('heading', { name: '已归档 Workspace' }))
      .toBeVisible()
    await expect.element(page.getByText('Active Workspace')).toBeVisible()
    await expect.element(page.getByText('Archived Workspace')).toBeVisible()
    await expect
      .element(page.getByText('租户名称暂不可用').first())
      .toBeVisible()
    await expect
      .element(page.getByText('当前账号没有可访问的 Workspace'))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByText('继续上次访问的 Workspace'))
      .not.toBeInTheDocument()
    await expect.element(page.getByText('tenant-a')).not.toBeInTheDocument()

    await page.getByRole('button', { name: '重试租户目录' }).click()
    expect(directory.tenantQuery.refetch).toHaveBeenCalledOnce()
    await page.getByRole('link', { name: '进入 Workspace' }).first().click()
    expect(navigate).toHaveBeenCalledWith({ to: '/w/workspace-active' })
  })

  it('does not show workspace entries or an empty state when only the workspace directory fails', async () => {
    setDirectoryState({ workspaceError: true })
    recentWorkspace.current = directory.workspaces[0]
    const tenantRetry = directory.tenantQuery.refetch
    const workspaceRetry = directory.workspaceQuery.refetch

    render(<AuthenticatedHome />)

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('无法加载 Workspace 目录')
    await expect
      .element(page.getByRole('alert'))
      .not.toHaveTextContent('无法加载租户目录')
    await expect
      .element(page.getByRole('heading', { name: '已加载的租户' }))
      .toBeVisible()
    await expect
      .element(page.getByText('当前账号没有可访问的 Workspace'))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByText('暂无此状态的 Workspace。'))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByText('继续上次访问的 Workspace'))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('link', { name: '进入 Workspace' }))
      .not.toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
    expect(saveRecentWorkspace).not.toHaveBeenCalled()

    await page.getByRole('button', { name: '重试 Workspace 目录' }).click()
    expect(workspaceRetry).toHaveBeenCalledOnce()
    expect(tenantRetry).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('shows the archived card and state without automatically entering an archived-only directory', async () => {
    const archivedOnly = baseWorkspaces.filter(
      (workspace) => workspace.status === 'archived'
    )
    setDirectoryState({ workspaces: archivedOnly })

    render(<AuthenticatedHome />)

    await expect
      .element(page.getByRole('heading', { name: '活动 Workspace' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('heading', { name: '已归档 Workspace' }))
      .toBeVisible()
    await expect.element(page.getByText('Archived Workspace')).toBeVisible()
    await expect
      .element(page.getByText('状态：已归档', { exact: true }))
      .toBeVisible()
    await expect
      .element(page.getByText('当前账号没有可访问的 Workspace'))
      .not.toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
    expect(saveRecentWorkspace).not.toHaveBeenCalled()
  })

  it('renders directory failures, tenant-name fallback, and accessible names in English', async () => {
    setLocale('en')
    setDirectoryState({ workspaceError: true })
    recentWorkspace.current = directory.workspaces[0]

    render(<AuthenticatedHome />)

    await expect
      .element(page.getByRole('heading', { name: 'Workbench' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Could not load the Workspace directory')
    await expect
      .element(page.getByRole('button', { name: 'Retry Workspace directory' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Retry tenant directory' }))
      .not.toBeInTheDocument()
    await expect
      .element(
        page.getByText(
          'Only successfully loaded directory data is shown. A failed directory is not evidence of permissions or that no Workspaces exist. Retry the failed directory.'
        )
      )
      .toBeVisible()
    await expect
      .element(page.getByText('No accessible Workspaces for this account'))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('link', { name: 'Open Workspace' }))
      .not.toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()

    await cleanup()
    setDirectoryState({ tenantError: true })
    directory.tenants = []
    directory.tenantById = new Map()
    recentWorkspace.current = directory.workspaces[0]
    render(<AuthenticatedHome />)

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('Could not load the tenant directory')
    await expect
      .element(page.getByRole('button', { name: 'Retry tenant directory' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Retry Workspace directory' }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('heading', { name: 'Active Workspaces' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('heading', { name: 'Archived Workspaces' }))
      .toBeVisible()
    await expect
      .element(page.getByText('Tenant name temporarily unavailable').first())
      .toBeVisible()
    await expect
      .element(page.getByRole('link', { name: 'Open Workspace' }).first())
      .toBeVisible()
    await expect
      .element(page.getByText('tenant-a', { exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByText('Continue to your last Workspace'))
      .not.toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('fits 320px and 390px viewports and opens the explicit workspace link by keyboard', async () => {
    render(<AuthenticatedHome />)

    for (const width of [320, 390]) {
      await page.viewport(width, 844)
      expect(window.innerWidth).toBe(width)
      expect(document.querySelector('main')!.scrollWidth).toBeLessThanOrEqual(
        width
      )
    }

    const openWorkspaceLink = page
      .getByRole('link', { name: '进入 Workspace' })
      .first()
    await userEvent.tab()
    await expect.element(openWorkspaceLink).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(saveRecentWorkspace).toHaveBeenCalledWith(
      'actor-a',
      directory.workspaces[0]
    )
    expect(navigate).toHaveBeenCalledWith({ to: '/w/workspace-active' })
  })

  it('offers a recent workspace only when it is present in the current directory', async () => {
    recentWorkspace.current = directory.workspaces[0]
    render(<AuthenticatedHome />)
    await expect
      .element(page.getByText('继续上次访问的 Workspace'))
      .toBeVisible()

    cleanup()
    recentWorkspace.current = {
      ...directory.workspaces[0],
      workspace_id: 'workspace-no-longer-accessible',
    }
    render(<AuthenticatedHome />)
    await expect
      .element(page.getByText('继续上次访问的 Workspace'))
      .not.toBeInTheDocument()
  })
})
