import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { setLocale } from '@/lib/i18n'
import { WorkspaceRouteLayout } from './context'
import { useWorkspaceDirectory } from './directory'
import type { Workspace } from './types'
import {
  isWorkspaceAccessUnavailable,
  workspaceRecoveryReason,
} from './workspace-recovery-messages'

type DetailResponse = { status: number; code: string } | { networkError: true }

function fixtureWorkspace(workspaceId: string): Workspace {
  return {
    workspace_id: workspaceId,
    tenant_id: 'tenant-7',
    slug: `workspace-${workspaceId}`,
    name: workspaceId === '11' ? 'Restricted name' : 'Sales',
    icon: null,
    status: 'active',
    workspace_role: 'owner',
    membership_version: 3,
  }
}

function installApiFixture(detailResponses: DetailResponse[] = []) {
  const state = {
    detailCalls: 0,
    detailResponses: [...detailResponses],
    directoryCalls: 0,
    methods: [] as string[],
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  const problem = (status: number, code: string) =>
    json(
      {
        status,
        code,
        detail: 'SENSITIVE backend detail and Restricted name',
      },
      status
    )

  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin
      )
      state.methods.push(init?.method ?? 'GET')
      if (url.pathname === '/api/v1/tenants')
        return json({
          items: [
            { tenant_id: 'tenant-7', name: 'North', tenant_role: 'member' },
          ],
          total: 1,
          page: 1,
          page_size: 100,
        })
      if (url.pathname === '/api/v1/workspaces') {
        state.directoryCalls += 1
        return json({
          items: [fixtureWorkspace('12')],
          total: 1,
          page: 1,
          page_size: 100,
        })
      }
      const match = url.pathname.match(/^\/api\/v1\/workspaces\/(\d+)$/)
      if (match) {
        state.detailCalls += 1
        const response = state.detailResponses.shift()
        if (response && 'networkError' in response)
          throw new TypeError('simulated offline response')
        if (response) return problem(response.status, response.code)
        return json(fixtureWorkspace(match[1]))
      }
      throw new Error(`Unexpected simulated API request: ${url.pathname}`)
    }
  )
  return state
}

function TestRoot() {
  useWorkspaceDirectory(true)
  return <Outlet />
}

function AccessibleDirectory() {
  const { workspaces } = useWorkspaceDirectory(true)
  return (
    <p>Server directory: {workspaces.map((item) => item.name).join(', ')}</p>
  )
}

function PrivateWorkspaceContent() {
  return <p>Private workspace content</p>
}

async function renderWorkspace(queryClient = new QueryClient()) {
  const root = createRootRoute({ component: TestRoot })
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
    component: Outlet,
  })
  const workspace = createRoute({
    getParentRoute: () => authenticated,
    path: 'w/$workspaceId',
    component: WorkspaceRouteLayout,
  })
  const privateContent = createRoute({
    getParentRoute: () => workspace,
    path: 'private',
    component: PrivateWorkspaceContent,
  })
  const home = createRoute({
    getParentRoute: () => authenticated,
    path: '/',
    component: AccessibleDirectory,
  })
  const signIn = createRoute({
    getParentRoute: () => root,
    path: 'sign-in',
    component: () => <p>Sign-in boundary</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([
      authenticated.addChildren([
        workspace.addChildren([privateContent]),
        home,
      ]),
      signIn,
    ]),
    history: createMemoryHistory({ initialEntries: ['/w/11/private'] }),
  })
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { queryClient, router, screen }
}

function seedRecentWorkspace(workspaceId = '11') {
  window.localStorage.setItem(
    'synapse:recent-workspace:actor-1',
    JSON.stringify(fixtureWorkspace(workspaceId))
  )
}

function setAuthenticatedActor() {
  useAuthStore.getState().auth.setUser({
    user_id: 'actor-1',
    user_name: 'fixture-user',
    nick_name: null,
    email: null,
    phonenumber: null,
    sex: null,
    avatar: null,
    status: 'active',
    platform_role: 'user',
  })
}

describe('Workspace route recovery with simulated API responses', () => {
  beforeEach(() => {
    setLocale('zh-CN')
    setAuthenticatedActor()
    window.localStorage.removeItem('synapse:recent-workspace:actor-1')
  })

  afterEach(async () => {
    await cleanup()
    vi.unstubAllGlobals()
    useAuthStore.getState().auth.reset()
    window.localStorage.removeItem('synapse:recent-workspace:actor-1')
    setLocale('zh-CN')
  })

  it.each([
    [403, 'MEMBERSHIP_INACTIVE', 'tenantMembershipInactive', true],
    [403, 'WORKSPACE_MEMBERSHIP_REQUIRED', 'workspaceMembershipInactive', true],
    [403, 'FORBIDDEN', 'actionDenied', false],
    [403, 'UNKNOWN_FORBIDDEN', 'requestFailed', false],
    [404, 'RESOURCE_NOT_FOUND', 'resourceUnavailable', true],
    [404, 'UNKNOWN_NOT_FOUND', 'requestFailed', false],
    [409, 'TENANT_INACTIVE', 'tenantInactive', true],
    [409, 'WORKSPACE_INACTIVE', 'workspaceInactive', true],
    [409, 'LAST_OWNER_REQUIRED', 'contextConflict', false],
    [409, 'UNKNOWN_CONFLICT', 'requestFailed', false],
    [400, 'CONTEXT_MISMATCH', 'contextConflict', false],
  ] as const)(
    'keeps the route and applies exact cleanup for simulated %i %s',
    async (status, code, expectedReason, clearsAccess) => {
      installApiFixture([{ status, code }])
      seedRecentWorkspace()
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const targetKey = [
        'synapse',
        'actor-1',
        'tenant-7',
        '11',
        'workspace-detail',
      ] as const
      const otherTenantKey = [
        'synapse',
        'actor-1',
        'tenant-8',
        '11',
        'workspace-detail',
      ] as const
      const otherActorKey = [
        'synapse',
        'actor-2',
        'tenant-7',
        '11',
        'workspace-detail',
      ] as const
      const otherWorkspaceKey = [
        'synapse',
        'actor-1',
        'tenant-7',
        '12',
        'workspace-detail',
      ] as const
      queryClient.setQueryData(targetKey, 'target-secret')
      queryClient.setQueryData(otherTenantKey, 'other-tenant-secret')
      queryClient.setQueryData(otherActorKey, 'other-actor-secret')
      queryClient.setQueryData(otherWorkspaceKey, 'other-workspace-secret')

      const { router, screen } = await renderWorkspace(queryClient)
      await expect.element(screen.getByRole('alert')).toHaveTextContent(/空间/)

      expect(router.state.location.pathname).toBe('/w/11/private')
      expect(workspaceRecoveryReason(status, code)).toBe(expectedReason)
      expect(document.body.textContent).not.toContain(
        'Private workspace content'
      )
      expect(document.body.textContent).not.toContain(
        'SENSITIVE backend detail'
      )
      expect(document.body.textContent).not.toContain('Restricted name')
      expect(isWorkspaceAccessUnavailable(expectedReason)).toBe(clearsAccess)
      if (clearsAccess) {
        expect(
          window.localStorage.getItem('synapse:recent-workspace:actor-1')
        ).toBeNull()
        expect(queryClient.getQueryData(targetKey)).toBeUndefined()
      } else {
        expect(
          window.localStorage.getItem('synapse:recent-workspace:actor-1')
        ).not.toBeNull()
        expect(queryClient.getQueryData(targetKey)).toBe('target-secret')
      }
      expect(queryClient.getQueryData(otherTenantKey)).toBe(
        'other-tenant-secret'
      )
      expect(queryClient.getQueryData(otherActorKey)).toBe('other-actor-secret')
      expect(queryClient.getQueryData(otherWorkspaceKey)).toBe(
        'other-workspace-secret'
      )
    }
  )

  it.each([
    ['network failure', { networkError: true }],
    ['5xx failure', { status: 503, code: 'SERVICE_UNAVAILABLE' }],
  ] as const)(
    'hides cached content and preserves recent state after simulated %s',
    async (_label, response) => {
      installApiFixture([response])
      seedRecentWorkspace()
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const targetKey = [
        'synapse',
        'actor-1',
        'tenant-7',
        '11',
        'workspace-detail',
      ] as const
      queryClient.setQueryData(targetKey, 'stale-private-cache')

      const { router, screen } = await renderWorkspace(queryClient)
      await expect
        .element(screen.getByRole('alert'))
        .toHaveTextContent('无法确认此空间的访问状态')
      expect(router.state.location.pathname).toBe('/w/11/private')
      expect(document.body.textContent).not.toContain('stale-private-cache')
      expect(
        window.localStorage.getItem('synapse:recent-workspace:actor-1')
      ).not.toBeNull()
      expect(queryClient.getQueryData(targetKey)).toBe('stale-private-cache')
    }
  )

  it('removes the current Workspace cache when neither directory nor recent metadata resolves it', async () => {
    installApiFixture([
      { status: 403, code: 'WORKSPACE_MEMBERSHIP_REQUIRED' },
    ])
    seedRecentWorkspace('12')
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const targetKey = [
      'synapse',
      'actor-1',
      'tenant-7',
      '11',
      'workspace-detail',
    ] as const
    const otherTenantKey = [
      'synapse',
      'actor-1',
      'tenant-8',
      '11',
      'workspace-detail',
    ] as const
    const otherActorKey = [
      'synapse',
      'actor-2',
      'tenant-7',
      '11',
      'workspace-detail',
    ] as const
    const otherWorkspaceKey = [
      'synapse',
      'actor-1',
      'tenant-7',
      '12',
      'workspace-detail',
    ] as const
    queryClient.setQueryData(targetKey, fixtureWorkspace('11'))
    queryClient.setQueryData(otherTenantKey, 'other-tenant-secret')
    queryClient.setQueryData(otherActorKey, 'other-actor-secret')
    queryClient.setQueryData(otherWorkspaceKey, 'other-workspace-secret')

    const { router, screen } = await renderWorkspace(queryClient)
    await expect.element(screen.getByRole('alert')).toBeInTheDocument()

    expect(router.state.location.pathname).toBe('/w/11/private')
    expect(queryClient.getQueryData(targetKey)).toBeUndefined()
    expect(queryClient.getQueryData(otherTenantKey)).toBe(
      'other-tenant-secret'
    )
    expect(queryClient.getQueryData(otherActorKey)).toBe('other-actor-secret')
    expect(queryClient.getQueryData(otherWorkspaceKey)).toBe(
      'other-workspace-secret'
    )
    expect(
      JSON.parse(
        window.localStorage.getItem('synapse:recent-workspace:actor-1') ?? '{}'
      ).workspace_id
    ).toBe('12')
  })

  it('retries only the read-only Workspace check and keeps the route on success', async () => {
    const fixture = installApiFixture([
      { status: 503, code: 'SERVICE_UNAVAILABLE' },
    ])
    seedRecentWorkspace()
    const { router, screen } = await renderWorkspace()
    await expect
      .element(screen.getByRole('button', { name: '重试' }))
      .toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    await expect
      .element(screen.getByText('Private workspace content'))
      .toBeInTheDocument()

    expect(router.state.location.pathname).toBe('/w/11/private')
    expect(fixture.detailCalls).toBe(2)
    expect(fixture.methods.every((method) => method === 'GET')).toBe(true)
  })

  it('navigates to the current server directory only after the user selects it', async () => {
    const fixture = installApiFixture([
      { status: 403, code: 'WORKSPACE_MEMBERSHIP_REQUIRED' },
    ])
    seedRecentWorkspace()
    const { router, screen } = await renderWorkspace()
    await expect
      .element(screen.getByRole('button', { name: '查看可访问空间' }))
      .toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/w/11/private')
    const previousDirectoryCalls = fixture.directoryCalls

    await userEvent.click(
      screen.getByRole('button', { name: '查看可访问空间' })
    )
    await expect
      .element(screen.getByText('Server directory: Sales'))
      .toBeInTheDocument()

    expect(router.state.location.pathname).toBe('/')
    expect(fixture.directoryCalls).toBeGreaterThan(previousDirectoryCalls)
    expect(document.body.textContent).not.toContain('Restricted name')
  })

  it('uses English recovery copy without exposing the backend detail', async () => {
    installApiFixture([{ status: 404, code: 'RESOURCE_NOT_FOUND' }])
    setLocale('en')
    const { screen } = await renderWorkspace()
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('This Workspace does not exist or is unavailable.')
    expect(document.body.textContent).not.toContain('SENSITIVE backend detail')
  })

  it('only clears the matching recent Workspace after a simulated explicit rejection', async () => {
    installApiFixture([{ status: 403, code: 'WORKSPACE_MEMBERSHIP_REQUIRED' }])
    seedRecentWorkspace('12')
    const { screen } = await renderWorkspace()
    await expect.element(screen.getByRole('alert')).toBeInTheDocument()

    expect(
      JSON.parse(
        window.localStorage.getItem('synapse:recent-workspace:actor-1') ?? '{}'
      ).workspace_id
    ).toBe('12')
  })

  it('keeps the safe in-app return route through the simulated 401 auth boundary', async () => {
    installApiFixture([{ status: 401, code: 'AUTHENTICATION_REQUIRED' }])
    const { router, screen } = await renderWorkspace()
    await expect
      .element(screen.getByText('Sign-in boundary'))
      .toBeInTheDocument()

    expect(router.state.location.pathname).toBe('/sign-in')
    expect(router.state.location.search).toEqual({
      redirect: '/w/11/private',
    })
  })
})
