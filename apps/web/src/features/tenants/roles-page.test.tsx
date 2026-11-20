import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { setLocale } from '@/lib/i18n'
import { TenantRolesPage } from './roles-page'

const { routeHarness } = vi.hoisted(() => ({
  routeHarness: {
    tenantId: '42',
    search: { page: 1, q: '', status: '' },
    navigations: [] as unknown[],
  },
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => routeHarness.search,
    useNavigate: () => async (options: unknown) => {
      routeHarness.navigations.push(options)
    },
  }),
  useParams: () => ({ tenantId: routeHarness.tenantId }),
}))

type RoleFixture = {
  role_id: string
  tenant_id: string
  scope: 'tenant'
  role_name: string
  role_key: string
  role_sort: number
  status: 'active' | 'disabled'
  permissions: string[]
  remark: string | null
  created_at: string | null
  updated_at: string | null
}

type RoleFixtureState = {
  tenantRole: 'owner' | 'admin' | 'member'
  tenantGate: Promise<Response> | null
  roleFailureStatus: number | null
  roles: RoleFixture[]
  requests: Array<{
    path: string
    search: string
    method: string
    body?: Record<string, unknown>
  }>
}

const sampleRole = (tenantId = '42'): RoleFixture => ({
  role_id: 'role-100',
  tenant_id: tenantId,
  scope: 'tenant',
  role_name: 'Support analyst',
  role_key: 'support_analyst',
  role_sort: 10,
  status: 'active',
  permissions: ['tenant:read'],
  remark: null,
  created_at: '2026-11-18T00:00:00Z',
  updated_at: '2026-11-18T00:00:00Z',
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function installApiFixture({
  tenantRole = 'owner',
  roleFailureStatus = null,
  roles = [],
}: {
  tenantRole?: RoleFixtureState['tenantRole']
  roleFailureStatus?: number | null
  roles?: RoleFixture[]
} = {}) {
  const fixture: RoleFixtureState = {
    tenantRole,
    tenantGate: null,
    roleFailureStatus,
    roles: [...roles],
    requests: [],
  }

  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin
      )
      const method = init?.method ?? 'GET'
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined
      fixture.requests.push({
        path: url.pathname,
        search: url.search,
        method,
        body,
      })

      if (method === 'GET' && url.pathname === '/api/v1/tenants/42') {
        if (fixture.tenantGate) return fixture.tenantGate
        return json({
          tenant_id: '42',
          slug: 'fixture-tenant',
          name: 'Fixture tenant',
          status: 'active',
          valid_from: null,
          valid_until: null,
          settings: {},
          tenant_role: fixture.tenantRole,
          membership_version: 8,
          created_at: '2026-11-18T00:00:00Z',
          updated_at: '2026-11-18T00:00:00Z',
        })
      }

      if (url.pathname === '/api/v1/tenants/42/roles' && method === 'GET') {
        if (fixture.roleFailureStatus)
          return json(
            {
              code: 'SERVICE_UNAVAILABLE',
              detail: 'fixture role service unavailable',
            },
            fixture.roleFailureStatus
          )
        return json({
          items: fixture.roles,
          total: fixture.roles.length,
          page: 1,
          page_size: 20,
        })
      }

      if (url.pathname === '/api/v1/tenants/42/roles' && method === 'POST') {
        const created: RoleFixture = {
          ...sampleRole('42'),
          role_id: 'role-created',
          role_name: String(body?.role_name),
          role_key: String(body?.role_key),
          role_sort: Number(body?.role_sort),
          status: body?.status === 'disabled' ? 'disabled' : 'active',
          permissions: Array.isArray(body?.permissions)
            ? (body.permissions as string[])
            : [],
          remark: typeof body?.remark === 'string' ? body.remark : null,
        }
        fixture.roles = [...fixture.roles, created]
        return json(created, 201)
      }

      throw new Error(`Unexpected role fixture request: ${method} ${url}`)
    }
  )

  return fixture
}

function setActor() {
  useAuthStore.getState().auth.setUser({
    user_id: 'actor-a',
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

async function mountPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <TenantRolesPage />
    </QueryClientProvider>
  )
  return { screen, queryClient }
}

describe('Tenant roles page (fixture HTTP API)', () => {
  beforeEach(() => {
    routeHarness.tenantId = '42'
    routeHarness.search = { page: 1, q: '', status: '' }
    routeHarness.navigations = []
    setLocale('zh-CN')
    setActor()
  })

  afterEach(async () => {
    await cleanup()
    vi.unstubAllGlobals()
    useAuthStore.getState().auth.reset()
  })

  it('keeps tenant loading, an empty role list, and a role-list failure as separate states', async () => {
    const fixture = installApiFixture()
    const tenantResponse = deferred<Response>()
    fixture.tenantGate = tenantResponse.promise

    const { screen } = await mountPage()
    await expect.element(screen.getByText('正在加载租户…')).toBeInTheDocument()

    tenantResponse.resolve(
      json({
        tenant_id: '42',
        slug: 'fixture-tenant',
        name: 'Fixture tenant',
        status: 'active',
        valid_from: null,
        valid_until: null,
        settings: {},
        tenant_role: 'owner',
        membership_version: 8,
        created_at: '2026-11-18T00:00:00Z',
        updated_at: '2026-11-18T00:00:00Z',
      })
    )
    await expect.element(screen.getByText('暂无租户角色')).toBeInTheDocument()
    expect(
      fixture.requests.some(
        (request) => request.path === '/api/v1/tenants/42/roles'
      )
    ).toBe(true)

    await cleanup()
    vi.unstubAllGlobals()

    const failed = installApiFixture({ roleFailureStatus: 503 })
    const retryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const retryScreen = await render(
      <QueryClientProvider client={retryClient}>
        <TenantRolesPage />
      </QueryClientProvider>
    )
    await expect
      .element(retryScreen.getByRole('alert'))
      .toHaveTextContent('fixture role service unavailable')
    await expect
      .element(retryScreen.getByText('暂无租户角色'))
      .not.toBeInTheDocument()
    expect(failed.requests.some((request) => request.method === 'GET')).toBe(
      true
    )
  })

  it('denies role management to a tenant member without requesting tenant role data', async () => {
    const fixture = installApiFixture({ tenantRole: 'member' })
    const { screen } = await mountPage()

    await expect
      .element(screen.getByText('仅租户所有者或管理员可以管理租户角色。'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '创建角色', exact: true }))
      .not.toBeInTheDocument()
    expect(
      fixture.requests.some((request) => request.path.endsWith('/roles'))
    ).toBe(false)
  })

  it('creates a role only under the route tenant and preserves its explicit tenant permissions', async () => {
    const fixture = installApiFixture()
    const { screen } = await mountPage()

    await userEvent.click(
      screen.getByRole('button', { name: '创建角色', exact: true })
    )
    const form = screen.getByRole('form', { name: '创建角色' })
    await userEvent.fill(
      form.getByRole('textbox', { name: '角色名称' }),
      'Support analyst'
    )
    await userEvent.fill(
      form.getByRole('textbox', { name: '角色标识' }),
      'support_analyst'
    )
    await userEvent.click(form.getByText('管理租户成员'))
    await userEvent.click(form.getByRole('button', { name: '创建角色' }))

    await expect
      .element(screen.getByText('Support analyst', { exact: true }))
      .toBeInTheDocument()
    expect(
      fixture.requests.find(
        (request) =>
          request.method === 'POST' && request.path.endsWith('/roles')
      )?.body
    ).toEqual({
      role_name: 'Support analyst',
      role_key: 'support_analyst',
      role_sort: 0,
      status: 'active',
      permissions: ['tenant_member:manage'],
      remark: '',
    })
    expect(
      fixture.requests.every((request) =>
        request.path.startsWith('/api/v1/tenants/42')
      )
    ).toBe(true)
    expect(
      fixture.requests.some((request) =>
        request.path.startsWith('/api/v1/tenants/99')
      )
    ).toBe(false)
  })
})
