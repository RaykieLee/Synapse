import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { Workspace } from '@/api/workspaces'
import { useAuthStore } from '@/stores/auth-store'
import { queryKeys } from '@/lib/query-keys'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TeamSwitcher } from './directory'
import type { TenantSummary } from './types'

const { routeHarness } = vi.hoisted(() => ({
  routeHarness: {
    pathname: '/',
    navigations: [] as string[],
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => (options: { to: string }) => {
    routeHarness.navigations.push(options.to)
  },
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown
  }) => select({ location: { pathname: routeHarness.pathname } }),
}))

type DirectorySnapshot = {
  tenants: TenantSummary[]
  workspaces: Workspace[]
}

type DirectoryFixture = {
  currentActor: string
  snapshots: Record<string, DirectorySnapshot>
  failPath: string | null
  workspaceGate: Promise<void> | null
  requests: Array<{ path: string; search: string }>
}

const tenant = (
  tenantId: string,
  name: string,
  tenantRole: TenantSummary['tenant_role']
): TenantSummary => ({ tenant_id: tenantId, name, tenant_role: tenantRole })

const workspace = (
  workspaceId: string,
  tenantId: string,
  name: string,
  status: Workspace['status'] = 'active',
  workspaceRole: Workspace['workspace_role'] = 'owner'
): Workspace => ({
  workspace_id: workspaceId,
  tenant_id: tenantId,
  slug: `workspace-${workspaceId}`,
  name,
  icon: null,
  status,
  workspace_role: workspaceRole,
  membership_version: 3,
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installDirectoryFixture(
  snapshots: DirectoryFixture['snapshots'] = {
    'actor-a': {
      tenants: [
        tenant('7', 'Northwind', 'owner'),
        tenant('8', 'Contoso', 'member'),
      ],
      workspaces: [
        workspace('11', '7', 'Design workspace'),
        workspace('12', '7', 'Archived admin workspace', 'archived', 'admin'),
        workspace('13', '8', 'Archived viewer workspace', 'archived', 'viewer'),
        workspace('99', '99', 'Unrelated tenant workspace'),
      ],
    },
  }
) {
  const fixture: DirectoryFixture = {
    currentActor: 'actor-a',
    snapshots,
    failPath: null,
    workspaceGate: null,
    requests: [],
  }

  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin
    )
    fixture.requests.push({ path: url.pathname, search: url.search })

    if (fixture.failPath === url.pathname)
      return json(
        { code: 'SERVICE_UNAVAILABLE', detail: 'fixture unavailable' },
        503
      )

    const snapshot = fixture.snapshots[fixture.currentActor]
    if (url.pathname === '/api/v1/tenants')
      return json({
        items: snapshot.tenants,
        total: snapshot.tenants.length,
        page: 1,
        page_size: 100,
      })

    if (url.pathname === '/api/v1/workspaces') {
      if (fixture.workspaceGate) await fixture.workspaceGate
      return json({
        items: snapshot.workspaces,
        total: snapshot.workspaces.length,
        page: 1,
        page_size: 100,
      })
    }

    throw new Error(`Unexpected directory fixture request: ${url.pathname}`)
  })

  return fixture
}

function setActor(userId: string) {
  useAuthStore.getState().auth.setUser({
    user_id: userId,
    user_name: userId,
    nick_name: null,
    email: null,
    phonenumber: null,
    sex: null,
    avatar: null,
    status: 'active',
    platform_role: 'user',
  })
}

async function mountSwitcher() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <TeamSwitcher />
      </SidebarProvider>
    </QueryClientProvider>
  )
  return { screen, queryClient }
}

function workspaceDirectoryQueryKey(actorId: string) {
  return queryKeys.workspace.query(
    queryKeys.actorScope(actorId),
    'directory',
    { includeArchived: true, page: 1, pageSize: 100 }
  )
}

async function openSwitcher(
  screen: Awaited<ReturnType<typeof mountSwitcher>>['screen']
) {
  await userEvent.click(screen.getByRole('button', { name: '选择工作区' }))
}

describe('Workspace directory and switcher (fixture HTTP API)', () => {
  beforeEach(() => {
    routeHarness.pathname = '/'
    routeHarness.navigations = []
    window.localStorage.clear()
    setActor('actor-a')
  })

  afterEach(async () => {
    await cleanup()
    vi.unstubAllGlobals()
    useAuthStore.getState().auth.reset()
  })

  it('shows a loading state, then an explicit empty state without adding write actions', async () => {
    let releaseWorkspaces: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseWorkspaces = resolve
    })
    const fixture = installDirectoryFixture({
      'actor-a': { tenants: [], workspaces: [] },
    })
    fixture.workspaceGate = gate

    const { screen } = await mountSwitcher()
    await openSwitcher(screen)
    await expect.element(screen.getByText('正在加载空间…')).toBeInTheDocument()

    releaseWorkspaces?.()
    await expect
      .element(screen.getByText('没有匹配的可访问空间'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('创建空间', { exact: true }))
      .not.toBeInTheDocument()
    expect(
      fixture.requests.some((request) => request.path === '/api/v1/workspaces')
    ).toBe(true)
  })

  it('fails closed on a workspace-list error instead of exposing unrelated or stale workspaces', async () => {
    const fixture = installDirectoryFixture()
    fixture.failPath = '/api/v1/workspaces'

    const { screen, queryClient } = await mountSwitcher()
    await openSwitcher(screen)
    await expect
      .element(screen.getByText('Unrelated tenant workspace'))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText('创建空间', { exact: true }))
      .toBeInTheDocument()

    expect(
      queryClient.getQueryState(workspaceDirectoryQueryKey('actor-a'))?.status
    ).toBe('error')
  })

  it('filters by active tenant membership and workspace role, then switches within the selected actor scope', async () => {
    const fixture = installDirectoryFixture({
      'actor-a': {
        tenants: [
          tenant('7', 'Northwind', 'owner'),
          tenant('8', 'Contoso', 'member'),
        ],
        workspaces: [
          workspace('11', '7', 'Design workspace'),
          workspace('12', '7', 'Archived admin workspace', 'archived', 'admin'),
          workspace(
            '13',
            '8',
            'Archived viewer workspace',
            'archived',
            'viewer'
          ),
          workspace('99', '99', 'Unrelated tenant workspace'),
        ],
      },
      'actor-b': {
        tenants: [tenant('9', 'Fabrikam', 'member')],
        workspaces: [workspace('21', '9', 'Actor B workspace')],
      },
    })
    const { screen, queryClient } = await mountSwitcher()

    await openSwitcher(screen)
    await expect
      .element(screen.getByText('Design workspace', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Archived admin workspace', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Archived viewer workspace', { exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText('Unrelated tenant workspace', { exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText('创建空间', { exact: true }))
      .toBeInTheDocument()

    await userEvent.click(screen.getByText('Design workspace', { exact: true }))
    expect(routeHarness.navigations).toContain('/w/11')
    expect(
      JSON.parse(
        window.localStorage.getItem('synapse:recent-workspace:actor-a')!
      ).workspace_id
    ).toBe('11')

    fixture.currentActor = 'actor-b'
    setActor('actor-b')
    await openSwitcher(screen)
    await expect
      .element(screen.getByText('Actor B workspace', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Design workspace', { exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText('创建空间', { exact: true }))
      .not.toBeInTheDocument()

    const actorADirectoryKey = workspaceDirectoryQueryKey('actor-a')
    const actorBDirectoryKey = workspaceDirectoryQueryKey('actor-b')
    expect(actorADirectoryKey).not.toEqual(actorBDirectoryKey)
    expect(queryClient.getQueryState(actorADirectoryKey)?.status).toBe('success')
    expect(queryClient.getQueryState(actorBDirectoryKey)?.status).toBe('success')

    const actorAWorkspaceIds = queryClient
      .getQueryData<{ items: Workspace[] }>(actorADirectoryKey)
      ?.items.map((item) => item.workspace_id)
    const actorBWorkspaceIds = queryClient
      .getQueryData<{ items: Workspace[] }>(actorBDirectoryKey)
      ?.items.map((item) => item.workspace_id)
    expect(actorAWorkspaceIds).toContain('11')
    expect(actorAWorkspaceIds).not.toContain('21')
    expect(actorBWorkspaceIds).toContain('21')
    expect(actorBWorkspaceIds).not.toContain('11')
    expect(fixture.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/api/v1/workspaces',
          search: '?page=1&page_size=100&include_archived=true',
        }),
      ])
    )
  })
})
