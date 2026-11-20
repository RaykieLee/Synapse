// All HTTP responses are deterministic fixtures; these tests do not call a real model or provider.
import type { ComponentProps, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { Workspace } from '@/api/workspaces'
import { useAuthStore } from '@/stores/auth-store'
import { setLocale } from '@/lib/i18n'
import { queryKeys, workspaceQueryScope } from '@/lib/query-keys'
import { AgentScopeChatPage } from './page'

const { fixtureContext } = vi.hoisted(() => ({
  fixtureContext: {
    actorId: 'actor-a',
    workspace: {
      workspace_id: '11',
      tenant_id: '7',
      slug: 'fixture-workspace-11',
      name: 'Fixture workspace 11',
      icon: null,
      status: 'active',
      workspace_role: 'owner',
      membership_version: 3,
    } as Workspace,
  },
}))

vi.mock('@/features/workspaces/context', () => ({
  useWorkspace: () => fixtureContext,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params?: { workspaceId?: string }
    children: ReactNode
  } & ComponentProps<'a'>) => (
    <a {...props} href={to.replace('$workspaceId', params?.workspaceId ?? '')}>
      {children}
    </a>
  ),
}))

// Keep the details surface in-flow so this focused interaction test can reach
// the separate message card; integrated modal/focus behavior needs its own acceptance.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <>{children}</> : null,
  DialogClose: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children, ...props }: ComponentProps<'div'>) => (
    <div {...props} role='dialog'>
      {children}
    </div>
  ),
  DialogDescription: ({ children, ...props }: ComponentProps<'p'>) => (
    <p {...props}>{children}</p>
  ),
  DialogFooter: ({ children, ...props }: ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  ),
  DialogHeader: ({ children, ...props }: ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  ),
  DialogOverlay: () => null,
  DialogPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTitle: ({ children, ...props }: ComponentProps<'h2'>) => (
    <h2 {...props}>{children}</h2>
  ),
  DialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./use-realtime-voice', () => ({
  useRealtimeVoice: () => ({
    error: null,
    isBusy: false,
    state: 'idle',
    toggle: async () => undefined,
    userConfirm: async () => undefined,
  }),
}))

vi.mock('./components/session-config-panel', () => ({
  SessionConfigPanel: () => null,
}))

type ChatStatus =
  | 'running'
  | 'idle'
  | 'awaiting_permission'
  | 'awaiting_external_result'

type ChatFixture = {
  agentGate: Promise<Response> | null
  agentFailureStatus: number | null
  emptyAgents: boolean
  sessionFailureStatus: number | null
  historyFailureStatus: number | null
  chatFailureStatus: number | null
  chatGate: Promise<Response> | null
  interruptGate: Promise<Response> | null
  statusByWorkspace: Record<string, ChatStatus>
  requests: Array<{
    path: string
    search: string
    method: string
    workspaceId: string | null
    body?: Record<string, unknown>
  }>
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function problem(status: number, code: string, detail: string) {
  return json({ status, code, detail }, status)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function session(workspaceId: string) {
  return {
    session: {
      id: `session-${workspaceId}`,
      agent_id: 'agent-1',
      user_id: 'actor-a',
      origin: { type: 'user' },
      team_id: null,
      config: {
        name: `Fixture session ${workspaceId}`,
        workspace_id: workspaceId,
        chat_model_config: {
          type: 'openai_chat',
          credential_id: 'fixture-credential',
          model: 'fixture-model',
          parameters: {},
        },
      },
      state: { permission_context: { mode: 'default' } },
    },
    is_running: false,
    status: 'idle' as const,
    team: null,
  }
}

function installApiFixture() {
  const fixture: ChatFixture = {
    agentGate: null,
    agentFailureStatus: null,
    emptyAgents: false,
    sessionFailureStatus: null,
    historyFailureStatus: null,
    chatFailureStatus: null,
    chatGate: null,
    interruptGate: null,
    statusByWorkspace: { '11': 'idle', '12': 'idle' },
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
      const headers = new Headers(init?.headers)
      const workspaceId = headers.get('X-Workspace-ID')
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined
      fixture.requests.push({
        path: url.pathname,
        search: url.search,
        method,
        workspaceId,
        body,
      })

      if (url.pathname === '/api/v1/ai/agent/' && method === 'GET') {
        if (fixture.agentGate) return fixture.agentGate
        if (fixture.agentFailureStatus)
          return problem(
            fixture.agentFailureStatus,
            'SERVICE_UNAVAILABLE',
            'fixture agent list unavailable'
          )
        return json({
          agents: fixture.emptyAgents
            ? []
            : [
                {
                  id: 'agent-1',
                  data: { name: 'Fixture agent' },
                  editable: true,
                },
              ],
          total: fixture.emptyAgents ? 0 : 1,
        })
      }

      if (url.pathname === '/api/v1/ai/sessions/' && method === 'GET') {
        if (fixture.sessionFailureStatus)
          return problem(
            fixture.sessionFailureStatus,
            'SERVICE_UNAVAILABLE',
            'fixture session list unavailable'
          )
        const selectedWorkspace = workspaceId ?? 'missing-scope'
        const items = ['11', '12'].includes(selectedWorkspace)
          ? [session(selectedWorkspace)]
          : []
        return json({ sessions: items, total: items.length })
      }

      const messageMatch = url.pathname.match(
        /^\/api\/v1\/ai\/sessions\/([^/]+)\/messages$/
      )
      if (messageMatch && method === 'GET') {
        if (fixture.historyFailureStatus)
          return problem(
            fixture.historyFailureStatus,
            'SERVICE_UNAVAILABLE',
            'fixture message history unavailable'
          )
        return json({ messages: [], is_running: false, has_more: false })
      }

      if (
        /^\/api\/v1\/workspaces\/[^/]+\/attachments$/.test(url.pathname) &&
        method === 'GET'
      )
        return json({ items: [], total: 0, page: 1, page_size: 100 })

      if (/^\/api\/v1\/ai\/sessions\/[^/]+\/stream$/.test(url.pathname))
        return problem(503, 'SERVICE_UNAVAILABLE', 'fixture stream unavailable')

      if (url.pathname === '/api/v1/ai/chat/' && method === 'POST') {
        if (fixture.chatGate) {
          const response = await fixture.chatGate
          if (response.ok && workspaceId)
            fixture.statusByWorkspace[workspaceId] = 'running'
          return response
        }
        if (fixture.chatFailureStatus)
          return problem(
            fixture.chatFailureStatus,
            'SERVICE_UNAVAILABLE',
            'fixture chat endpoint unavailable'
          )
        if (workspaceId) fixture.statusByWorkspace[workspaceId] = 'running'
        return json({ status: 'started', session_id: body?.session_id }, 202)
      }

      const statusMatch = url.pathname.match(
        /^\/api\/v1\/ai\/sessions\/([^/]+)\/status$/
      )
      if (statusMatch && method === 'GET')
        return json({
          session_id: statusMatch[1],
          status: fixture.statusByWorkspace[workspaceId ?? ''] ?? 'idle',
        })

      const interruptMatch = url.pathname.match(
        /^\/api\/v1\/ai\/sessions\/([^/]+)\/interrupt$/
      )
      if (interruptMatch && method === 'POST') {
        if (fixture.interruptGate) {
          const response = await fixture.interruptGate
          if (response.ok && workspaceId)
            fixture.statusByWorkspace[workspaceId] = 'idle'
          return response
        }
        if (workspaceId) fixture.statusByWorkspace[workspaceId] = 'idle'
        return json({ session_id: interruptMatch[1] }, 202)
      }

      throw new Error(`Unexpected AgentScope fixture request: ${method} ${url}`)
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

function setWorkspace(
  workspaceId: string,
  tenantId = '7',
  status: Workspace['status'] = 'active'
) {
  fixtureContext.workspace = {
    workspace_id: workspaceId,
    tenant_id: tenantId,
    slug: `fixture-workspace-${workspaceId}`,
    name: `Fixture workspace ${workspaceId}`,
    icon: null,
    status,
    workspace_role: 'owner',
    membership_version: 3,
  }
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
      <AgentScopeChatPage />
    </QueryClientProvider>
  )
  return { screen, queryClient }
}

async function selectSession(
  screen: Awaited<ReturnType<typeof mountPage>>['screen'],
  workspaceId: string
) {
  const row = screen.getByRole('button', {
    name: new RegExp(`Fixture session ${workspaceId}`),
  })
  await userEvent.click(row)
  await expect
    .element(screen.getByRole('heading', { name: '会话信息' }))
    .toBeInTheDocument()
}

describe('AgentScope chat page (fixture HTTP API)', () => {
  beforeEach(() => {
    setLocale('zh-CN')
    setActor()
    setWorkspace('11')
  })

  afterEach(async () => {
    await cleanup()
    vi.unstubAllGlobals()
    useAuthStore.getState().auth.reset()
  })

  it('distinguishes agent loading, the no-agent empty state, and an API failure', async () => {
    const fixture = installApiFixture()
    const agentResponse = deferred<Response>()
    fixture.agentGate = agentResponse.promise

    const { screen } = await mountPage()
    await expect
      .element(screen.getByRole('combobox', { name: '智能体' }))
      .toBeDisabled()
    agentResponse.resolve(json({ agents: [], total: 0 }))
    await expect
      .element(screen.getByRole('heading', { name: '请先创建智能体' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '新建会话', exact: true }))
      .toBeDisabled()

    await cleanup()
    vi.unstubAllGlobals()

    const failed = installApiFixture()
    failed.agentFailureStatus = 503
    const errorClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const errorScreen = await render(
      <QueryClientProvider client={errorClient}>
        <AgentScopeChatPage />
      </QueryClientProvider>
    )
    await expect
      .element(errorScreen.getByRole('alert'))
      .toHaveTextContent('fixture agent list unavailable')
    await expect
      .element(errorScreen.getByRole('heading', { name: '请先创建智能体' }))
      .not.toBeInTheDocument()
  })

  it('keeps archived workspaces read-only and does not load message history', async () => {
    const fixture = installApiFixture()
    setWorkspace('11', '7', 'archived')
    const { screen } = await mountPage()

    await expect
      .element(
        screen.getByText('此 Workspace 已归档，当前不能读取或修改会话。')
      )
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '新建会话', exact: true }))
      .not.toBeInTheDocument()
    await selectSession(screen, '11')
    await expect
      .element(screen.getByRole('textbox', { name: '输入消息' }))
      .not.toBeInTheDocument()
    expect(
      fixture.requests.some((request) => request.path.endsWith('/messages'))
    ).toBe(false)
    expect(
      fixture.requests.some((request) => request.path.endsWith('/chat/'))
    ).toBe(false)
  })

  it('retains a failed message draft, retries it in the same Workspace, then locks duplicate interrupts', async () => {
    const fixture = installApiFixture()
    const { screen } = await mountPage()
    await selectSession(screen, '11')

    await expect
      .element(screen.getByText('还没有消息。发送第一条消息开始对话。'))
      .toBeInTheDocument()
    const composer = screen.getByRole('textbox', { name: /输入消息/ })
    await userEvent.fill(composer, 'A fixture-only question')

    const failedPost = deferred<Response>()
    fixture.chatGate = failedPost.promise
    await userEvent.click(
      screen.getByRole('button', { name: '发送', exact: true })
    )
    await expect
      .element(screen.getByRole('button', { name: '提交中…' }))
      .toBeDisabled()
    failedPost.resolve(
      problem(503, 'SERVICE_UNAVAILABLE', 'fixture chat endpoint unavailable')
    )
    await expect
      .element(screen.getByText('fixture chat endpoint unavailable'))
      .toBeInTheDocument()
    await expect.element(composer).toHaveValue('A fixture-only question')
    fixture.chatGate = null
    fixture.chatFailureStatus = null

    await userEvent.click(
      screen.getByRole('button', { name: '发送', exact: true })
    )
    await expect.element(composer).toHaveValue('')
    const interrupt = screen.getByRole('button', {
      name: '中断生成',
      exact: true,
    })
    await expect.element(interrupt).toBeEnabled()
    const requestBody = fixture.requests.find(
      (request) => request.path.endsWith('/chat/') && request.method === 'POST'
    )?.body
    expect(requestBody).toEqual({
      agent_id: 'agent-1',
      session_id: 'session-11',
      input: {
        role: 'user',
        name: 'user',
        content: [{ type: 'text', text: 'A fixture-only question' }],
      },
    })

    const interruptResponse = deferred<Response>()
    fixture.interruptGate = interruptResponse.promise
    await userEvent.click(interrupt)
    const pendingInterrupt = screen.getByRole('button', {
      name: '正在请求中断…',
    })
    await expect.element(pendingInterrupt).toBeDisabled()
    expect(
      fixture.requests.filter((request) => request.path.endsWith('/interrupt'))
    ).toHaveLength(1)
    interruptResponse.resolve(json({ session_id: 'session-11' }, 202))
    await expect.element(composer).toBeEnabled()
    await expect
      .element(screen.getByRole('button', { name: '中断生成', exact: true }))
      .not.toBeInTheDocument()

    const scopedRequests = fixture.requests.filter(
      (request) =>
        request.path.includes('/ai/') || request.path.includes('/attachments')
    )
    expect(scopedRequests.length).toBeGreaterThan(0)
    expect(
      scopedRequests.every((request) => request.workspaceId === '11')
    ).toBe(true)
  })

  it('isolates agent sessions and query caches when the active tenant and Workspace change', async () => {
    const fixture = installApiFixture()
    const { screen, queryClient } = await mountPage()
    await expect
      .element(screen.getByRole('button', { name: /Fixture session 11/ }))
      .toBeInTheDocument()
    await selectSession(screen, '11')

    setWorkspace('12', '8')
    await screen.rerender(
      <QueryClientProvider client={queryClient}>
        <AgentScopeChatPage />
      </QueryClientProvider>
    )
    await expect
      .element(screen.getByRole('button', { name: /Fixture session 12/ }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: /Fixture session 11/ }))
      .not.toBeInTheDocument()
    await selectSession(screen, '12')

    const scopedRequests = fixture.requests.filter((request) =>
      request.path.includes('/ai/')
    )
    expect(scopedRequests.some((request) => request.workspaceId === '11')).toBe(
      true
    )
    expect(scopedRequests.some((request) => request.workspaceId === '12')).toBe(
      true
    )
    expect(
      scopedRequests.every((request) =>
        ['11', '12'].includes(request.workspaceId ?? '')
      )
    ).toBe(true)

    const workspace11AgentsKey = queryKeys.agentscope.query(
      workspaceQueryScope('actor-a', {
        tenant_id: '7',
        workspace_id: '11',
        membership_version: 3,
      }),
      ['chat', 'agents']
    )
    const workspace12AgentsKey = queryKeys.agentscope.query(
      workspaceQueryScope('actor-a', {
        tenant_id: '8',
        workspace_id: '12',
        membership_version: 3,
      }),
      ['chat', 'agents']
    )
    expect(workspace11AgentsKey).not.toEqual(workspace12AgentsKey)
    expect(queryClient.getQueryState(workspace11AgentsKey)?.status).toBe(
      'success'
    )
    expect(queryClient.getQueryState(workspace12AgentsKey)?.status).toBe(
      'success'
    )
  })
})
