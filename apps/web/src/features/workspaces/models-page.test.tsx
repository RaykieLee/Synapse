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
import type { Credential, ModelBinding, Provider } from '@/api/model-providers'
import type { WorkspaceRole } from '@/api/workspaces'
import { useAuthStore } from '@/stores/auth-store'
import { setLocale } from '@/lib/i18n'
import { WorkspaceRouteLayout } from './context'
import { modelProviderQueryKey } from './model-provider-query-key'
import { WorkspaceModelsPage } from './models-page'

describe('model provider query scope', () => {
  it('separates cached data when workspace membership changes', () => {
    const before = modelProviderQueryKey(
      'actor-1',
      'tenant-7',
      'workspace-11',
      3
    )
    const after = modelProviderQueryKey(
      'actor-1',
      'tenant-7',
      'workspace-11',
      4
    )

    expect(before).not.toEqual(after)
    expect(before[5]).toBe(3)
    expect(after[5]).toBe(4)
  })
})

// HTTP contract fixtures only: these tests never call a real model/provider.
function installApiFixture(role: WorkspaceRole = 'owner') {
  const provider: Provider = {
    provider_type: 'openai_chat',
    credential_type: 'openai_credential',
    label: 'OpenAI-compatible Chat',
    capabilities: ['chat'],
    credential_schema_version: 1,
    supports_custom_model_id: true,
    supports_base_url: true,
  }
  const credential: Credential = {
    credential_id: 'credential-11',
    workspace_id: '11',
    provider_type: 'openai_chat',
    name: 'Gateway credential',
    endpoint_host: 'llm.example.com',
    has_secret: true,
    owner: true,
    created_at: '2026-10-13T00:00:00Z',
    updated_at: '2026-10-13T00:00:00Z',
  }
  const model: ModelBinding = {
    model_binding_id: 'model-11',
    workspace_id: '11',
    display_name: 'Company chat',
    kind: 'chat',
    provider_type: 'openai_chat',
    credential_status: 'available',
    credential_provider: 'openai_chat',
    model: 'company-chat-v3',
    status: 'active',
    capabilities: {},
    default_parameters: {},
    created_by: '1',
    created_at: '2026-10-13T00:00:00Z',
    updated_at: '2026-10-13T00:00:00Z',
  }
  const state = {
    role,
    membershipVersion: 3,
    actorId: '1',
    credentials: { '11': [credential], '12': [] } as Record<
      string,
      Credential[]
    >,
    models: { '11': [model], '12': [] } as Record<string, ModelBinding[]>,
    patchFailure: 0,
    modelReferences: false,
    credentialGate: null as Promise<void> | null,
    mutationGate: null as Promise<void> | null,
    listFailures: {} as Record<string, number>,
    requests: [] as {
      method: string
      workspaceId: string
      resource: string
      body?: Record<string, unknown>
    }[],
  }
  const workspace = (id: string) => ({
    workspace_id: id,
    tenant_id: '7',
    slug: `fixture-${id}`,
    name: `Fixture workspace ${id}`,
    icon: null,
    status: 'active',
    workspace_role: state.role,
    membership_version: state.membershipVersion,
  })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  const problem = (status: number, code: string) =>
    json({ status, code }, status)

  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin
      )
      const method = init?.method ?? 'GET'
      if (url.pathname === '/api/v1/tenants')
        return json({
          items: [
            { tenant_id: '7', name: 'Fixture tenant', tenant_role: 'member' },
          ],
          total: 1,
          page: 1,
          page_size: 100,
        })
      if (url.pathname === '/api/v1/workspaces')
        return json({
          items: [workspace('11'), workspace('12')],
          total: 2,
          page: 1,
          page_size: 100,
        })
      const match = url.pathname.match(
        /^\/api\/v1\/workspaces\/(\d+)(?:\/ai\/(.*))?$/
      )
      if (!match) throw new Error(`Unexpected fixture URL: ${url.pathname}`)
      const [, workspaceId, resource] = match
      if (!resource) return json(workspace(workspaceId))
      if (new Headers(init?.headers).get('X-Workspace-ID') !== workspaceId)
        return problem(400, 'CONTEXT_MISMATCH')
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined
      state.requests.push({
        method,
        workspaceId,
        resource,
        body,
      })
      if (method === 'GET') {
        if (state.listFailures[resource])
          return problem(state.listFailures[resource], 'SERVICE_UNAVAILABLE')
        if (resource === 'providers') return json([provider])
        if (resource === 'credentials') {
          if (workspaceId === '11' && state.credentialGate)
            await state.credentialGate
          return json(
            state.actorId === '2'
              ? []
              : state.credentials[workspaceId]
          )
        }
        if (resource === 'models') return json(state.models[workspaceId])
      }
      if (method === 'POST' && resource === 'credentials') {
        if (state.role === 'viewer') return problem(403, 'FORBIDDEN')
        if (state.mutationGate) await state.mutationGate
        const created: Credential = {
          ...credential,
          credential_id: 'fixture-created-credential',
          workspace_id: workspaceId,
          name: String(body?.name),
          endpoint_host: new URL(String(body?.base_url)).host,
        }
        state.credentials[workspaceId].push(created)
        return json(created, 201)
      }
      if (method === 'PATCH' && resource.startsWith('credentials/')) {
        if (state.role === 'viewer') return problem(403, 'FORBIDDEN')
        if (state.patchFailure) {
          const status = state.patchFailure
          state.patchFailure = 0
          return problem(status, 'VALIDATION_ERROR')
        }
        const item = state.credentials[workspaceId].find(
          (entry) =>
            resource === `credentials/${entry.credential_id}` && entry.owner
        )
        if (!item) return problem(404, 'NOT_FOUND')
        if (state.mutationGate) await state.mutationGate
        if (typeof body?.name === 'string') item.name = body.name
        if (typeof body?.base_url === 'string')
          item.endpoint_host = new URL(body.base_url).host
        return json(item)
      }
      if (method === 'DELETE') {
        if (!['owner', 'admin'].includes(state.role))
          return problem(403, 'FORBIDDEN')
        if (resource.startsWith('credentials/')) {
          if (state.models[workspaceId].length)
            return problem(409, 'CREDENTIAL_IN_USE')
          state.credentials[workspaceId] = state.credentials[
            workspaceId
          ].filter((entry) => resource !== `credentials/${entry.credential_id}`)
        } else if (resource.startsWith('models/')) {
          if (state.modelReferences) return problem(409, 'MODEL_BINDING_IN_USE')
          state.models[workspaceId] = state.models[workspaceId].filter(
            (entry) => resource !== `models/${entry.model_binding_id}`
          )
        } else throw new Error(`Unexpected fixture deletion: ${resource}`)
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected fixture action: ${method} ${resource}`)
    }
  )
  return state
}

async function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const root = createRootRoute({ component: Outlet })
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
  const models = createRoute({
    getParentRoute: () => workspace,
    path: 'models',
    component: WorkspaceModelsPage,
  })
  const router = createRouter({
    routeTree: root.addChildren([
      authenticated.addChildren([workspace.addChildren([models])]),
    ]),
    history: createMemoryHistory({ initialEntries: ['/w/11/models'] }),
  })
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { screen, router, queryClient }
}

describe('Workspace models page (browser with fixture HTTP API)', () => {
  beforeEach(() => {
    setLocale('zh-CN')
    window.localStorage.removeItem('synapse:recent-workspace:1')
    useAuthStore.getState().auth.setUser({
      user_id: '1',
      user_name: 'fixture-user',
      nick_name: null,
      email: null,
      phonenumber: null,
      sex: null,
      avatar: null,
      status: 'active',
      platform_role: 'user',
    })
  })

  afterEach(async () => {
    await cleanup()
    vi.unstubAllGlobals()
    useAuthStore.getState().auth.reset()
  })

  it('rotates an owned credential without reading a secret back and retains non-secret edits after an API failure', async () => {
    const fixture = installApiFixture()
    fixture.patchFailure = 422
    const { screen } = await renderPage()
    await userEvent.click(screen.getByRole('button', { name: '编辑 / 轮换' }))
    const form = screen.getByRole('form', { name: '编辑凭据' })
    const name = form.getByLabelText('名称', { exact: true })
    const endpoint = form.getByLabelText('Endpoint', { exact: true })
    const secret = form.getByLabelText('新 API key', { exact: true })
    await expect.element(secret).toHaveValue('')
    await expect.element(endpoint).toHaveValue('')
    await userEvent.fill(name, 'Renamed credential')
    await userEvent.fill(endpoint, 'https://new.example.com/custom/v1')
    await userEvent.fill(secret, 'fixture-rotation-secret')
    await userEvent.click(form.getByRole('button', { name: '保存凭据' }))
    await expect
      .element(form.getByRole('alert'))
      .toHaveTextContent('提交内容无效，请检查字段后重试。')
    await expect.element(name).toHaveValue('Renamed credential')
    await expect
      .element(endpoint)
      .toHaveValue('https://new.example.com/custom/v1')
    await expect.element(secret).toHaveValue('')
    await userEvent.fill(secret, 'fixture-new-secret')
    await userEvent.click(form.getByRole('button', { name: '保存凭据' }))
    await expect.element(form).not.toBeInTheDocument()
    await expect
      .element(screen.getByText('Renamed credential', { exact: true }))
      .toBeInTheDocument()
    expect(
      fixture.requests
        .filter((request) => request.method === 'PATCH')
        .slice(-1)[0]?.body
    ).toEqual({
      name: 'Renamed credential',
      base_url: 'https://new.example.com/custom/v1',
      api_key: 'fixture-new-secret',
    })
    expect(document.body.textContent).not.toContain('fixture-new-secret')
    await userEvent.click(screen.getByRole('button', { name: '编辑 / 轮换' }))
    await expect
      .element(form.getByLabelText('新 API key', { exact: true }))
      .toHaveValue('')
    await expect
      .element(form.getByLabelText('Endpoint', { exact: true }))
      .toHaveValue('')
  })

  it('requires confirmation, retains in-use resources after server conflicts and deletes only after references are removed', async () => {
    const fixture = installApiFixture()
    const { screen } = await renderPage()
    await userEvent.click(
      screen.getByRole('button', { name: '删除凭据', exact: true })
    )
    const credentialDialog = screen.getByRole('alertdialog', {
      name: '删除凭据',
      exact: true,
    })
    await expect
      .element(
        credentialDialog.getByText('Gateway credential', { exact: true })
      )
      .toBeInTheDocument()
    expect(
      fixture.requests.filter((request) => request.method === 'DELETE')
    ).toHaveLength(0)
    await userEvent.click(
      credentialDialog.getByRole('button', { name: '取消', exact: true })
    )
    await expect.element(credentialDialog).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '删除凭据', exact: true }))
      .toHaveFocus()
    await userEvent.click(
      screen.getByRole('button', { name: '删除凭据', exact: true })
    )
    await userEvent.click(
      credentialDialog.getByRole('button', { name: '确认删除', exact: true })
    )
    await expect
      .element(credentialDialog.getByRole('alert'))
      .toHaveTextContent('凭据正被模型引用，请先删除关联模型后重试。')
    await userEvent.click(
      credentialDialog.getByRole('button', { name: '取消', exact: true })
    )
    await expect
      .element(screen.getByRole('article', { name: 'Gateway credential' }))
      .toBeInTheDocument()

    fixture.modelReferences = true
    await userEvent.click(
      screen.getByRole('button', { name: '删除模型', exact: true })
    )
    const modelDialog = screen.getByRole('alertdialog', {
      name: '删除模型',
      exact: true,
    })
    await userEvent.click(
      modelDialog.getByRole('button', { name: '确认删除', exact: true })
    )
    await expect
      .element(modelDialog.getByRole('alert'))
      .toHaveTextContent('模型正被其他资源引用，无法删除。请先解除引用后重试。')
    fixture.modelReferences = false
    await userEvent.click(
      modelDialog.getByRole('button', { name: '确认删除', exact: true })
    )
    await expect.element(modelDialog).not.toBeInTheDocument()
    await expect
      .element(screen.getByText('Company chat', { exact: true }))
      .not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: '删除凭据', exact: true })
    )
    await userEvent.click(
      credentialDialog.getByRole('button', { name: '确认删除', exact: true })
    )
    await expect.element(credentialDialog).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('article', { name: 'Gateway credential' }))
      .not.toBeInTheDocument()
  })

  it('allows a member to edit an owned credential but reserves deletion and model management for managers', async () => {
    const fixture = installApiFixture('member')
    const { screen } = await renderPage()
    await expect
      .element(screen.getByRole('button', { name: '编辑 / 轮换' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '删除凭据' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '删除模型' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('form', { name: '添加模型' }))
      .not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '编辑 / 轮换' }))
    const form = screen.getByRole('form', { name: '编辑凭据' })
    await userEvent.fill(
      form.getByLabelText('名称', { exact: true }),
      'Member renamed credential'
    )
    await userEvent.click(form.getByRole('button', { name: '保存凭据' }))
    await expect
      .element(screen.getByText('Member renamed credential', { exact: true }))
      .toBeInTheDocument()
    expect(
      fixture.requests.find((request) => request.method === 'PATCH')?.body
    ).toEqual({ name: 'Member renamed credential' })
  })

  it('shows viewers a read-only explanation and exposes no write controls', async () => {
    const fixture = installApiFixture('viewer')
    const { screen } = await renderPage()
    await expect
      .element(
        screen.getByText(
          '当前账号只有只读权限，不能添加、编辑或删除模型与凭据。'
        )
      )
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('article', { name: 'Gateway credential' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Company chat', { exact: true }))
      .toBeInTheDocument()
    for (const name of [
      '添加凭据',
      '添加模型',
      '编辑 / 轮换',
      '删除凭据',
      '删除模型',
    ])
      await expect
        .element(screen.getByRole('button', { name, exact: true }))
        .not.toBeInTheDocument()
    expect(fixture.requests.every((request) => request.method === 'GET')).toBe(
      true
    )
  })

  it('leaves ownership checks authoritative even for a manager', async () => {
    const fixture = installApiFixture('admin')
    fixture.credentials['11'][0].owner = false
    const { screen } = await renderPage()
    const row = screen.getByRole('article', { name: 'Gateway credential' })
    await expect
      .element(row.getByText('仅凭据所有者可编辑或删除。'))
      .toBeInTheDocument()
    await expect
      .element(row.getByRole('button', { name: '编辑 / 轮换' }))
      .not.toBeInTheDocument()
    await expect
      .element(row.getByRole('button', { name: '删除凭据' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '删除模型' }))
      .toBeInTheDocument()
  })

  it('handles a server-side viewer downgrade without optimistic edits or deletes and discards the dirty key after permissions refresh', async () => {
    const fixture = installApiFixture()
    const { screen, queryClient } = await renderPage()
    await userEvent.click(screen.getByRole('button', { name: '编辑 / 轮换' }))
    const form = screen.getByRole('form', { name: '编辑凭据' })
    await userEvent.fill(
      form.getByLabelText('名称', { exact: true }),
      'Forbidden rename'
    )
    await userEvent.fill(
      form.getByLabelText('新 API key', { exact: true }),
      'fixture-denied-secret'
    )
    fixture.role = 'viewer'
    await userEvent.click(form.getByRole('button', { name: '保存凭据' }))
    await expect
      .element(form.getByRole('alert'))
      .toHaveTextContent('当前账号没有执行此操作的权限。')
    await expect
      .element(form.getByLabelText('新 API key', { exact: true }))
      .toHaveValue('')
    await userEvent.click(
      form.getByRole('button', { name: '取消', exact: true })
    )
    await userEvent.click(
      screen.getByRole('button', { name: '删除凭据', exact: true })
    )
    const dialog = screen.getByRole('alertdialog', {
      name: '删除凭据',
      exact: true,
    })
    await userEvent.click(
      dialog.getByRole('button', { name: '确认删除', exact: true })
    )
    await expect
      .element(dialog.getByRole('alert'))
      .toHaveTextContent('当前账号没有执行此操作的权限。')
    await userEvent.click(
      dialog.getByRole('button', { name: '取消', exact: true })
    )
    await expect
      .element(screen.getByText('Gateway credential', { exact: true }))
      .toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '编辑 / 轮换' }))
    await userEvent.fill(
      form.getByLabelText('新 API key', { exact: true }),
      'fixture-dirty-before-downgrade'
    )
    fixture.membershipVersion = 4
    await queryClient.invalidateQueries({
      queryKey: ['synapse', '1', '7', '11', 'workspace-detail'],
    })
    await expect
      .element(
        screen.getByText(
          '当前账号只有只读权限，不能添加、编辑或删除模型与凭据。'
        )
      )
      .toBeInTheDocument()
    await expect.element(form).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '编辑 / 轮换' }))
      .not.toBeInTheDocument()
  })

  it('discards private form drafts when switching workspaces and never presents a different workspace cache', async () => {
    installApiFixture()
    const { screen, router } = await renderPage()
    await userEvent.click(screen.getByRole('button', { name: '编辑 / 轮换' }))
    const form = screen.getByRole('form', { name: '编辑凭据' })
    await userEvent.fill(
      form.getByLabelText('新 API key', { exact: true }),
      'fixture-workspace-private-key'
    )
    await userEvent.click(
      form.getByRole('button', { name: '取消', exact: true })
    )
    await userEvent.click(
      screen.getByRole('button', { name: '添加模型', exact: true })
    )
    const modelForm = screen.getByRole('form', { name: '添加模型' })
    await userEvent.fill(
      modelForm.getByLabelText('显示名称'),
      'Workspace 11 draft'
    )
    await userEvent.click(
      modelForm.getByRole('button', { name: '取消', exact: true })
    )
    await router.navigate({
      to: '/w/$workspaceId/models',
      params: { workspaceId: '12' },
    })
    await expect
      .element(screen.getByText('当前账号在此空间还没有凭据。'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Gateway credential', { exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText('Company chat', { exact: true }))
      .not.toBeInTheDocument()
    await expect.element(form).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: '添加凭据', exact: true })
    )
    await expect
      .element(
        screen
          .getByRole('form', { name: '添加凭据' })
          .getByLabelText('API key', { exact: true })
      )
      .toHaveValue('')
    await router.navigate({
      to: '/w/$workspaceId/models',
      params: { workspaceId: '11' },
    })
    await expect
      .element(screen.getByText('Gateway credential', { exact: true }))
      .toBeInTheDocument()
    await expect.element(form).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: '添加模型', exact: true })
    )
    const reopenedModelForm = screen.getByRole('form', { name: '添加模型' })
    await expect
      .element(
        reopenedModelForm.getByLabelText('显示名称')
      )
      .toHaveValue('')
  })

  it('shows credential loading and ignores a late response from the workspace left behind', async () => {
    const fixture = installApiFixture()
    let release!: () => void
    fixture.credentialGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { screen, router, queryClient } = await renderPage()
    await expect.element(screen.getByText('正在加载凭据…')).toBeInTheDocument()
    await expect
      .element(screen.getByRole('form', { name: '添加凭据' }))
      .not.toBeInTheDocument()
    await router.navigate({
      to: '/w/$workspaceId/models',
      params: { workspaceId: '12' },
    })
    await expect
      .element(screen.getByText('当前账号在此空间还没有凭据。'))
      .toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: '添加凭据', exact: true })
    )
    release()
    await expect
      .poll(
        () =>
          queryClient.getQueryState([
            ...modelProviderQueryKey('1', '7', '11', 3),
            'credentials',
            '11',
          ])?.status
      )
      .toBe('success')
    await expect
      .element(screen.getByText('Gateway credential', { exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(
        screen
          .getByRole('form', { name: '添加凭据' })
          .getByLabelText('API key', { exact: true })
      )
      .toHaveValue('')
  })

  it('shows a retryable provider error instead of an empty provider section or enabled creation form', async () => {
    const fixture = installApiFixture()
    fixture.listFailures.providers = 503
    const { screen } = await renderPage()
    const section = screen.getByRole('region', { name: '已注册提供商' })
    await expect
      .element(section.getByRole('alert'))
      .toHaveTextContent('无法加载提供商。 服务暂不可用，请稍后重试。')
    await expect
      .element(screen.getByRole('form', { name: '添加凭据' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('form', { name: '添加模型' }))
      .not.toBeInTheDocument()
    fixture.listFailures.providers = 0
    await userEvent.click(
      section.getByRole('button', { name: '重试', exact: true })
    )
    await expect
      .element(screen.getByRole('button', { name: '添加凭据', exact: true }))
      .toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: '添加凭据', exact: true })
    )
    await expect
      .element(screen.getByRole('form', { name: '添加凭据' }))
      .toBeInTheDocument()
    await expect.element(section.getByRole('alert')).not.toBeInTheDocument()
    await expect
      .element(
        screen.getByText(
          '当前仅管理配置；尚未接入 AgentScope 运行时，也未验证提供商连接。'
        )
      )
      .toBeInTheDocument()
  })

  it.each([
    { action: 'create', switchTo: 'actor' },
    { action: 'rotate', switchTo: 'workspace' },
  ] as const)(
    'isolates a deferred $action response after switching $switchTo',
    async ({ action, switchTo }) => {
      const fixture = installApiFixture()
      let release!: () => void
      fixture.mutationGate = new Promise<void>((resolve) => {
        release = resolve
      })
      const { screen, router, queryClient } = await renderPage()
      if (action === 'create') {
        await userEvent.click(
          screen.getByRole('button', { name: '添加凭据', exact: true })
        )
        const form = screen.getByRole('form', { name: '添加凭据' })
        await userEvent.fill(
          form.getByLabelText('名称', { exact: true }),
          'Origin account credential'
        )
        await userEvent.fill(
          form.getByLabelText('API key', { exact: true }),
          'fixture-origin-create-key'
        )
        await userEvent.click(
          form.getByRole('button', { name: '添加凭据', exact: true })
        )
      } else {
        await userEvent.click(
          screen.getByRole('button', { name: '编辑 / 轮换' })
        )
        const form = screen.getByRole('form', { name: '编辑凭据' })
        await userEvent.fill(
          form.getByLabelText('名称', { exact: true }),
          'Origin workspace credential'
        )
        await userEvent.fill(
          form.getByLabelText('新 API key', { exact: true }),
          'fixture-origin-rotate-key'
        )
        await userEvent.click(form.getByRole('button', { name: '保存凭据' }))
      }
      const method = action === 'create' ? 'POST' : 'PATCH'
      await expect
        .poll(
          () =>
            fixture.requests.filter((request) => request.method === method)
              .length
        )
        .toBe(1)
      if (switchTo === 'actor') {
        useAuthStore
          .getState()
          .auth.setUser({
            ...useAuthStore.getState().auth.user!,
            user_id: '2',
            user_name: 'fixture-other-actor',
          })
        fixture.actorId = '2'
      } else
        await router.navigate({
          to: '/w/$workspaceId/models',
          params: { workspaceId: '12' },
        })
      await expect
        .element(screen.getByText('当前账号在此空间还没有凭据。'))
        .toBeInTheDocument()
      await expect
        .element(screen.getByRole('form', { name: '编辑凭据' }))
        .not.toBeInTheDocument()
      await expect
        .element(screen.getByRole('button', { name: '添加凭据', exact: true }))
        .toBeInTheDocument()
      await userEvent.click(
        screen.getByRole('button', { name: '添加凭据', exact: true })
      )
      const nextForm = screen.getByRole('form', { name: '添加凭据' })
      await expect
        .element(nextForm.getByLabelText('API key', { exact: true }))
        .toHaveValue('')
      await expect
        .element(nextForm.getByLabelText('名称', { exact: true }))
        .toHaveValue('')
      await userEvent.fill(
        nextForm.getByLabelText('名称', { exact: true }),
        'New context draft'
      )
      await userEvent.fill(
        nextForm.getByLabelText('API key', { exact: true }),
        'fixture-new-context-key'
      )
      const currentScope = modelProviderQueryKey(
        switchTo === 'actor' ? '2' : '1',
        '7',
        switchTo === 'actor' ? '11' : '12',
        3
      )
      const currentCredentials = [
        ...currentScope,
        'credentials',
        switchTo === 'actor' ? '11' : '12',
      ]
      const currentUpdatedAt =
        queryClient.getQueryState(currentCredentials)?.dataUpdatedAt
      release()
      await expect.poll(() => queryClient.isMutating()).toBe(0)
      await expect
        .element(nextForm.getByLabelText('名称', { exact: true }))
        .toHaveValue('New context draft')
      await expect
        .element(nextForm.getByLabelText('API key', { exact: true }))
        .toHaveValue('fixture-new-context-key')
      await expect
        .element(
          screen.getByText(
            action === 'create'
              ? 'Origin account credential'
              : 'Origin workspace credential',
            { exact: true }
          )
        )
        .not.toBeInTheDocument()
      expect(queryClient.getQueryState(currentCredentials)?.dataUpdatedAt).toBe(
        currentUpdatedAt
      )
      expect(
        fixture.requests.find((request) => request.method === method)
      ).toMatchObject({
        workspaceId: '11',
      })
      await expect
        .element(screen.getByRole('button', { name: '添加模型', exact: true }))
        .not.toBeInTheDocument()
    }
  )

  it('updates rendered labels, a retained API error and delete confirmation when switching to English', async () => {
    const fixture = installApiFixture()
    fixture.patchFailure = 422
    const { screen } = await renderPage()
    await userEvent.click(screen.getByRole('button', { name: '编辑 / 轮换' }))
    const form = screen.getByRole('form', { name: '编辑凭据' })
    await userEvent.fill(
      form.getByLabelText('新 API key', { exact: true }),
      'fixture-language-key'
    )
    await userEvent.click(form.getByRole('button', { name: '保存凭据' }))
    await expect
      .element(form.getByRole('alert'))
      .toHaveTextContent('提交内容无效，请检查字段后重试。')
    setLocale('en')
    const englishForm = screen.getByRole('form', { name: 'Edit credential' })
    await expect
      .element(englishForm.getByRole('alert'))
      .toHaveTextContent(
        'The submitted values are invalid. Check the fields and try again.'
      )
    await expect
      .element(englishForm.getByLabelText('New API key', { exact: true }))
      .toHaveValue('')
    expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/)
    await userEvent.click(
      englishForm.getByRole('button', { name: 'Cancel', exact: true })
    )
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Models and credentials',
          exact: true,
        })
      )
      .toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete credential', exact: true })
    )
    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete credential',
      exact: true,
    })
    await expect
      .element(
        dialog.getByText(
          'Deletion cannot be undone. Remove related model references before deleting this credential.'
        )
      )
      .toBeInTheDocument()
    await userEvent.click(
      dialog.getByRole('button', { name: 'Confirm delete', exact: true })
    )
    await expect
      .element(dialog.getByRole('alert'))
      .toHaveTextContent(
        'A model uses this credential. Remove the related model before deleting it.'
      )
    expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('localizes viewer restrictions in English', async () => {
    setLocale('en')
    installApiFixture('viewer')
    const { screen } = await renderPage()
    await expect
      .element(
        screen.getByText(
          'Your account has read-only access. You cannot add, edit, or delete models and credentials.'
        )
      )
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Gateway credential', { exact: true }))
      .toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/[\u3400-\u9fff]/)
  })
})
