import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { DirectionProvider } from '@/context/direction-provider'
import { FontProvider } from '@/context/font-provider'
import { ThemeProvider } from '@/context/theme-provider'
import type { Page, Workspace } from '@/api/workspaces'
import { useAuthStore } from '@/stores/auth-store'
import { setLocale } from '@/lib/i18n'
import { toast } from 'sonner'
import { queryKeys } from '@/lib/query-keys'
import {
  useWorkspace,
  validateWorkspaceRoute,
  workspaceDetailQueryKey,
  WorkspaceRouteLayout,
} from './context'

const workspaces: Workspace[] = []
const actorWorkspaces = new Map<string, Workspace[]>()
const actorTenants = new Map<string, string[]>()
const detailFailures = new Map<
  string,
  number | { status: number; title: string; detail: string }
>()
const requests: {
  method: string
  path: string
  headers: Headers
  actorId: string
  detailScope?: {
    tenantId: string
    workspaceId: string
    membershipVersion: number | undefined
  }
}[] = []
let activeActorId = 'actor-1'
let activeDetailFixture: Workspace | undefined
let fallbackDirectoryPause: Promise<void> | undefined
let releaseFallbackDirectory: (() => void) | undefined
let queryClient: QueryClient | undefined

function workspaceFixture(
  id: string,
  overrides: Partial<Workspace> = {}
): Workspace {
  return {
    workspace_id: id,
    tenant_id: 'tenant-7',
    slug: `workspace-${id}`,
    name: `Fixture workspace ${id}`,
    icon: null,
    status: 'active',
    workspace_role: 'owner',
    membership_version: 3,
    ...overrides,
  }
}

function setActor(actorId: string) {
  activeActorId = actorId
  useAuthStore.getState().auth.setUser({
    user_id: actorId,
    user_name: `fixture-${actorId}`,
    nick_name: null,
    email: null,
    phonenumber: null,
    sex: null,
    avatar: null,
    status: 'active',
    platform_role: 'user',
  })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installApiFixture() {
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin
      )
      const method = init?.method ?? 'GET'
      const headers = new Headers(init?.headers)
      const detailMatch = url.pathname.match(/^\/api\/v1\/workspaces\/([^/]+)$/)
      const navigationMatch = url.pathname.match(
        /^\/api\/v1\/tenants\/([^/]+)\/menus\/visible-tree$/
      )
      const detailScope =
        method === 'GET' &&
        detailMatch &&
        activeDetailFixture?.workspace_id === detailMatch[1]
          ? {
              tenantId: activeDetailFixture.tenant_id,
              workspaceId: activeDetailFixture.workspace_id,
              membershipVersion: activeDetailFixture.membership_version,
            }
          : undefined
      requests.push({
        method,
        path: url.pathname,
        headers,
        actorId: activeActorId,
        detailScope,
      })

      if (method === 'GET' && url.pathname === '/api/v1/tenants') {
        const tenantIds = actorTenants.get(activeActorId) ?? ['tenant-7']
        return json({
          items: tenantIds.map((tenantId) => ({
            tenant_id: tenantId,
            name: `Fixture tenant ${tenantId}`,
            tenant_role: 'owner',
          })),
          total: tenantIds.length,
          page: 1,
          page_size: 100,
        })
      }

      if (method === 'GET' && url.pathname === '/api/v1/workspaces') {
        if (
          !url.searchParams.has('include_archived') &&
          fallbackDirectoryPause
        )
          await fallbackDirectoryPause
        const directory = actorWorkspaces.get(activeActorId) ?? workspaces
        const body: Page<Workspace> = {
          items: [...directory],
          total: directory.length,
          page: Number(url.searchParams.get('page') ?? '1'),
          page_size: Number(url.searchParams.get('page_size') ?? '100'),
        }
        return json(body)
      }

      if (method === 'GET' && navigationMatch) {
        const tenantId = navigationMatch[1]
        const directory = actorWorkspaces.get(activeActorId) ?? workspaces
        const workspace = directory.find((item) => item.tenant_id === tenantId)
        return json({
          tenant_id: tenantId,
          membership_version: workspace?.membership_version ?? 0,
          items: [],
        })
      }

      if (method === 'GET' && detailMatch) {
        const workspaceId = detailMatch[1]
        if (headers.get('X-Workspace-ID') !== workspaceId)
          return json({ status: 400, code: 'CONTEXT_MISMATCH' }, 400)
        const failure = detailFailures.get(workspaceId)
        if (failure) {
          const status = typeof failure === 'number' ? failure : failure.status
          return json(
            {
              status,
              code: 'WORKSPACE_UNAVAILABLE',
              title:
                typeof failure === 'number'
                  ? `Server private title ${workspaceId}`
                  : failure.title,
              detail:
                typeof failure === 'number'
                  ? `Server private detail ${workspaceId}`
                  : failure.detail,
            },
            status
          )
        }
        return json(
          activeDetailFixture?.workspace_id === workspaceId
            ? activeDetailFixture
            : workspaceFixture(workspaceId)
        )
      }

      throw new Error(`Unexpected fixture request: ${method} ${url.pathname}`)
    }
  )
}

function WorkspaceProbe() {
  const { workspace } = useWorkspace()
  return (
    <p
      data-testid='workspace-context'
      data-workspace-id={workspace.workspace_id}
      data-tenant-id={workspace.tenant_id}
      data-membership-version={workspace.membership_version}
    >
      {workspace.name}
    </p>
  )
}

async function mountWorkspace(initialPath = '/w/11', fullShell = false) {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 10_000 },
      mutations: { retry: false },
    },
  })
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: Outlet,
  })
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <p>Fixture home</p>,
  })
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
    component: fullShell ? AuthenticatedLayout : Outlet,
  })
  const workspaceRoute = createRoute({
    getParentRoute: () => authenticated,
    path: 'w/$workspaceId',
    beforeLoad: ({ params, context }) =>
      validateWorkspaceRoute(params.workspaceId, context.queryClient),
    component: WorkspaceRouteLayout,
  })
  const index = createRoute({
    getParentRoute: () => workspaceRoute,
    path: '/',
    beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
    component: WorkspaceProbe,
  })
  const router = createRouter({
    routeTree: root.addChildren([
      home,
      authenticated.addChildren([workspaceRoute.addChildren([index])]),
    ]),
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  const routerProvider = <RouterProvider router={router} />
  const app = fullShell ? (
    <ThemeProvider>
      <FontProvider>
        <DirectionProvider>{routerProvider}</DirectionProvider>
      </FontProvider>
    </ThemeProvider>
  ) : (
    routerProvider
  )
  const screen = await render(
    <QueryClientProvider client={queryClient}>{app}</QueryClientProvider>
  )
  return { router, screen, queryClient }
}

function detailRequests(workspaceId: string) {
  return requests.filter(
    (request) =>
      request.method === 'GET' &&
      request.path === `/api/v1/workspaces/${workspaceId}`
  )
}

function workspaceDirectoryQueryKey(actorId: string) {
  return queryKeys.workspace.query(queryKeys.actorScope(actorId), 'directory', {
    includeArchived: true,
    page: 1,
    pageSize: 100,
  })
}

beforeEach(() => {
  setLocale('zh-CN')
  workspaces.length = 0
  actorWorkspaces.clear()
  actorTenants.clear()
  detailFailures.clear()
  requests.length = 0
  activeDetailFixture = undefined
  fallbackDirectoryPause = undefined
  releaseFallbackDirectory = undefined
  window.localStorage.removeItem('synapse:recent-workspace:actor-1')
  window.localStorage.removeItem('synapse:recent-workspace:actor-2')
  setActor('actor-1')
  installApiFixture()
})

afterEach(async () => {
  releaseFallbackDirectory?.()
  await cleanup()
  queryClient?.clear()
  queryClient = undefined
  window.localStorage.removeItem('synapse:recent-workspace:actor-1')
  window.localStorage.removeItem('synapse:recent-workspace:actor-2')
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setLocale('zh-CN')
})

describe('Workspace route query cache', () => {
  it('shares one scoped detail request between parent, child, layout and full-shell sidebar', async () => {
    const workspace = workspaceFixture('11')
    workspaces.push(workspace)
    const { screen, queryClient: client } = await mountWorkspace('/w/11', true)

    await expect
      .element(screen.getByTestId('workspace-context'))
      .toBeVisible()
    await expect
      .poll(
        () =>
          requests.filter(
            (request) =>
              request.method === 'GET' &&
              request.path ===
                '/api/v1/tenants/tenant-7/menus/visible-tree'
          ).length
      )
      .toBe(1)

    expect(detailRequests('11')).toHaveLength(1)
    expect(workspaceDetailQueryKey('actor-1', workspace)).toEqual(
      queryKeys.workspace.resource(
        {
          actorId: 'actor-1',
          tenantId: 'tenant-7',
          workspaceId: '11',
          membershipVersion: 3,
        },
        ['workspace-detail']
      )
    )
    expect(
      client.getQueryData(workspaceDetailQueryKey('actor-1', workspace))
    ).toEqual(workspace)
    expect(detailRequests('11')[0].headers.get('X-Workspace-ID')).toBe('11')
  })

  it('isolates detail caches as actor, tenant, workspace and membership version change', async () => {
    const actorOneTenantA = workspaceFixture('cache-workspace-11', {
      tenant_id: 'tenant-cache-a',
      name: 'Actor 1, tenant A, workspace 11, version 1',
      membership_version: 1,
    })
    const actorTwoTenantA = workspaceFixture('cache-workspace-11', {
      tenant_id: 'tenant-cache-a',
      name: 'Actor 2, tenant A, workspace 11, version 1',
      membership_version: 1,
    })
    const actorTwoTenantB = workspaceFixture('cache-workspace-11', {
      tenant_id: 'tenant-cache-b',
      name: 'Actor 2, tenant B, workspace 11, version 1',
      membership_version: 1,
    })
    const actorTwoWorkspace22Version1 = workspaceFixture(
      'cache-workspace-22',
      {
        tenant_id: 'tenant-cache-b',
        name: 'Actor 2, tenant B, workspace 22, version 1',
        membership_version: 1,
      }
    )
    const actorTwoWorkspace22Version2 = workspaceFixture(
      'cache-workspace-22',
      {
        tenant_id: 'tenant-cache-b',
        name: 'Actor 2, tenant B, workspace 22, version 2',
        membership_version: 2,
      }
    )
    actorTenants.set('actor-1', ['tenant-cache-a'])
    actorTenants.set('actor-2', ['tenant-cache-a', 'tenant-cache-b'])
    actorWorkspaces.set('actor-1', [actorOneTenantA])
    actorWorkspaces.set('actor-2', [actorTwoTenantA])
    activeDetailFixture = actorOneTenantA

    const { router, screen, queryClient: client } = await mountWorkspace(
      `/w/${actorOneTenantA.workspace_id}`
    )
    const assertRenderedWorkspace = async (
      actorId: string,
      workspace: Workspace
    ) => {
      await expect
        .element(screen.getByText(workspace.name, { exact: true }))
        .toBeVisible()
      const rendered = document.querySelector<HTMLElement>(
        '[data-testid="workspace-context"]'
      )
      expect(rendered?.dataset.workspaceId).toBe(workspace.workspace_id)
      expect(rendered?.dataset.tenantId).toBe(workspace.tenant_id)
      expect(rendered?.dataset.membershipVersion).toBe(
        String(workspace.membership_version)
      )
      expect(
        client.getQueryData(workspaceDetailQueryKey(actorId, workspace))
      ).toEqual(workspace)
    }

    await assertRenderedWorkspace('actor-1', actorOneTenantA)

    setActor('actor-2')
    activeDetailFixture = actorTwoTenantA
    await router.invalidate()
    await assertRenderedWorkspace('actor-2', actorTwoTenantA)
    expect(detailRequests(actorOneTenantA.workspace_id)).toHaveLength(2)

    actorWorkspaces.set('actor-2', [actorTwoTenantB])
    activeDetailFixture = actorTwoTenantB
    await client.invalidateQueries({
      queryKey: workspaceDirectoryQueryKey('actor-2'),
      exact: true,
    })
    await router.invalidate()
    await assertRenderedWorkspace('actor-2', actorTwoTenantB)
    expect(detailRequests(actorOneTenantA.workspace_id)).toHaveLength(3)

    actorWorkspaces.set('actor-2', [
      actorTwoTenantB,
      actorTwoWorkspace22Version1,
    ])
    activeDetailFixture = actorTwoWorkspace22Version1
    await client.invalidateQueries({
      queryKey: workspaceDirectoryQueryKey('actor-2'),
      exact: true,
    })
    await router.navigate({
      to: '/w/$workspaceId',
      params: { workspaceId: actorTwoWorkspace22Version1.workspace_id },
    })
    await assertRenderedWorkspace('actor-2', actorTwoWorkspace22Version1)

    actorWorkspaces.set('actor-2', [
      actorTwoTenantB,
      actorTwoWorkspace22Version2,
    ])
    activeDetailFixture = actorTwoWorkspace22Version2
    await client.invalidateQueries({
      queryKey: workspaceDirectoryQueryKey('actor-2'),
      exact: true,
    })
    await router.invalidate()
    await assertRenderedWorkspace('actor-2', actorTwoWorkspace22Version2)

    expect(detailRequests(actorTwoWorkspace22Version1.workspace_id)).toHaveLength(
      2
    )
    const requestScopes = requests.reduce<
      {
        actorId: string
        tenantId: string
        workspaceId: string
        membershipVersion: number | undefined
      }[]
    >((scopes, request) => {
      if (request.detailScope)
        scopes.push({ actorId: request.actorId, ...request.detailScope })
      return scopes
    }, [])
    expect(requestScopes).toEqual([
      {
        actorId: 'actor-1',
        tenantId: 'tenant-cache-a',
        workspaceId: 'cache-workspace-11',
        membershipVersion: 1,
      },
      {
        actorId: 'actor-2',
        tenantId: 'tenant-cache-a',
        workspaceId: 'cache-workspace-11',
        membershipVersion: 1,
      },
      {
        actorId: 'actor-2',
        tenantId: 'tenant-cache-b',
        workspaceId: 'cache-workspace-11',
        membershipVersion: 1,
      },
      {
        actorId: 'actor-2',
        tenantId: 'tenant-cache-b',
        workspaceId: 'cache-workspace-22',
        membershipVersion: 1,
      },
      {
        actorId: 'actor-2',
        tenantId: 'tenant-cache-b',
        workspaceId: 'cache-workspace-22',
        membershipVersion: 2,
      },
    ])

    const cachedVariants: [string, Workspace][] = [
      ['actor-1', actorOneTenantA],
      ['actor-2', actorTwoTenantA],
      ['actor-2', actorTwoTenantB],
      ['actor-2', actorTwoWorkspace22Version1],
      ['actor-2', actorTwoWorkspace22Version2],
    ]
    const serializedKeys = cachedVariants.map(([actorId, workspace]) =>
      JSON.stringify(workspaceDetailQueryKey(actorId, workspace))
    )
    expect(new Set(serializedKeys).size).toBe(cachedVariants.length)
    for (const [actorId, workspace] of cachedVariants)
      expect(
        client.getQueryData(workspaceDetailQueryKey(actorId, workspace))
      ).toEqual(workspace)
  })

  it.each([403, 404, 409])(
    'routes a %i detail failure to an active accessible workspace',
    async (status) => {
      const unavailableId = `private-workspace-id-${status}`
      const unavailableName = `Private workspace name ${status}`
      const privateServerTitle = `Private server title ${status}`
      const privateServerDetail = `Private server detail ${status}`
      const unavailableWorkspace = workspaceFixture(unavailableId, {
        name: unavailableName,
      })
      workspaces.push(workspaceFixture('12'))
      detailFailures.set(unavailableId, {
        status,
        title: privateServerTitle,
        detail: privateServerDetail,
      })
      window.localStorage.setItem(
        'synapse:recent-workspace:actor-1',
        JSON.stringify(unavailableWorkspace)
      )
      const toastError = vi.spyOn(toast, 'error')

      const { router, screen } = await mountWorkspace(`/w/${unavailableId}`)

      await expect
        .poll(() => router.state.location.pathname)
        .toBe('/w/12')
      await expect
        .element(screen.getByText('Fixture workspace 12', { exact: true }))
        .toBeVisible()
      expect(detailRequests(unavailableId)).toHaveLength(1)
      expect(detailRequests('12')).toHaveLength(1)
      expect(toastError).toHaveBeenCalledWith(
        '当前空间不可访问，已切换到可访问空间。'
      )
      const pageText = document.body.textContent ?? ''
      const toastText = toastError.mock.calls.flat().map(String).join('\n')
      for (const privateText of [
        unavailableName,
        unavailableId,
        privateServerTitle,
        privateServerDetail,
      ]) {
        expect(pageText).not.toContain(privateText)
        expect(toastText).not.toContain(privateText)
      }
      expect(
        window.localStorage.getItem('synapse:recent-workspace:actor-1')
      ).toBe(JSON.stringify(workspaceFixture('12')))
    }
  )

  it('hides server details during a mounted background access failure before fallback', async () => {
    const unavailableId = 'private-background-workspace-id'
    const unavailableName = 'Private background workspace name'
    const privateServerTitle = 'Private background server title'
    const privateServerDetail = 'Private background server detail'
    const unavailableWorkspace = workspaceFixture(unavailableId, {
      name: unavailableName,
    })
    workspaces.push(workspaceFixture('12'))
    window.localStorage.setItem(
      'synapse:recent-workspace:actor-1',
      JSON.stringify(unavailableWorkspace)
    )
    activeDetailFixture = unavailableWorkspace
    const { router, screen, queryClient: client } = await mountWorkspace(
      `/w/${unavailableId}`
    )
    await expect
      .element(screen.getByText(unavailableName, { exact: true }))
      .toBeVisible()

    let resumeFallback: (() => void) | undefined
    fallbackDirectoryPause = new Promise<void>((resolve) => {
      resumeFallback = resolve
      releaseFallbackDirectory = resolve
    })
    const toastError = vi.spyOn(toast, 'error')
    detailFailures.set(unavailableId, {
      status: 403,
      title: privateServerTitle,
      detail: privateServerDetail,
    })

    await client.invalidateQueries({
      queryKey: workspaceDetailQueryKey('actor-1', unavailableWorkspace),
      exact: true,
    })
    await expect
      .poll(() => document.body.textContent ?? '')
      .toContain('当前空间不可访问，正在切换…')
    expect(router.state.location.pathname).toBe(`/w/${unavailableId}`)
    const revalidationPageText = document.body.textContent ?? ''
    expect(revalidationPageText).not.toContain(unavailableName)
    expect(revalidationPageText).not.toContain(unavailableId)
    expect(revalidationPageText).not.toContain(privateServerTitle)
    expect(revalidationPageText).not.toContain(privateServerDetail)
    expect(toastError).not.toHaveBeenCalled()

    resumeFallback?.()
    fallbackDirectoryPause = undefined
    releaseFallbackDirectory = undefined
    await expect.poll(() => router.state.location.pathname).toBe('/w/12')
    await expect
      .element(screen.getByText('Fixture workspace 12', { exact: true }))
      .toBeVisible()

    expect(detailRequests(unavailableId)).toHaveLength(2)
    expect(detailRequests('12')).toHaveLength(1)
    expect(toastError).toHaveBeenCalledWith(
      '当前空间不可访问，已切换到可访问空间。'
    )
    const pageText = document.body.textContent ?? ''
    const toastText = toastError.mock.calls.flat().map(String).join('\n')
    for (const privateText of [
      unavailableName,
      unavailableId,
      privateServerTitle,
      privateServerDetail,
    ]) {
      expect(pageText).not.toContain(privateText)
      expect(toastText).not.toContain(privateText)
    }
  })

  it('returns to the workbench when no active accessible workspace remains', async () => {
    detailFailures.set('11', 403)

    const { router, screen } = await mountWorkspace()

    await expect.poll(() => router.state.location.pathname).toBe('/')
    await expect.element(screen.getByText('Fixture home')).toBeVisible()
    expect(detailRequests('11')).toHaveLength(1)
  })
})
