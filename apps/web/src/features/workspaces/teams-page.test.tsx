// Browser interaction tests use fixture HTTP responses only; no worker, model, or real API is exercised.
import type { ComponentProps, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, type RenderResult } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import type { Team, TeamRun } from '@/api/team-orchestration'
import { setLocale } from '@/lib/i18n'
import { WorkspaceTeamsPage } from './teams-page'
import type { Workspace } from './types'

const { fixtureContext } = vi.hoisted(() => ({
  fixtureContext: {
    actorId: 'actor-a',
    workspace: {
      workspace_id: '11',
      tenant_id: '7',
      name: 'Fixture Workspace',
      slug: 'fixture',
      icon: null,
      status: 'active',
      workspace_role: 'owner',
      membership_version: 3,
    } as Workspace,
  },
}))

vi.mock('./context', () => ({ useWorkspace: () => fixtureContext }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params: { workspaceId: string }
    children: ReactNode
  } & ComponentProps<'a'>) => (
    <a {...props} href={to.replace('$workspaceId', params.workspaceId)}>
      {children}
    </a>
  ),
}))

const base = '/api/v1/workspaces/11/teams'
const runPath = `${base}/team-a/runs/run-a`
const requests: {
  method: string
  path: string
  headers: Headers
  body?: Record<string, unknown>
}[] = []
const overrides = new Map<string, () => Response | Promise<Response>>()
let teamsFixture: Team[]
let runFixture: TeamRun
let queryClient: QueryClient

function teamFixture(): Team {
  return {
    team_id: 'team-a',
    workspace_id: '11',
    tenant_id: '7',
    name: 'Fixture team',
    description: 'Fixture team description',
    status: 'draft',
    visibility: 'workspace_shared',
    version: 1,
    created_by: 'actor-a',
    created_at: '2026-10-13T00:00:00Z',
    updated_at: '2026-10-13T00:00:00Z',
    members: [
      {
        member_id: 'member-a',
        agent_id: 'agent-a',
        role: 'leader',
        is_leader: true,
      },
    ],
    tasks: [
      {
        task_id: 'task-a',
        subject: 'Fixture task',
        description: '',
        owner_member_id: 'member-a',
        depends_on: [],
        allow_failure: false,
      },
    ],
  }
}

function runningFixture(): TeamRun {
  return {
    team_id: 'team-a',
    team_run_id: 'run-a',
    workspace_id: '11',
    team_version: 1,
    run_version: 1,
    status: 'running',
    execution_mode: 'durable_control_only',
    last_error: null,
    progress: {
      succeeded: 0,
      running: 0,
      waiting: 0,
      failed: 0,
      pending: 1,
      interrupted: 0,
      percent: 0,
    },
    members: [
      {
        member_id: 'member-a',
        agent_id: 'agent-a',
        status: 'pending',
        session_id: null,
      },
    ],
    tasks: [{ ...teamFixture().tasks[0], state: 'pending', attempt: 0 }],
    capabilities: {
      can_pause: false,
      can_resume: false,
      can_interrupt: true,
      interrupt_confirmation_pending: false,
      can_retry: false,
      can_execute: false,
    },
    created_at: '2026-10-13T00:00:00Z',
    updated_at: '2026-10-13T00:00:00Z',
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function accepted() {
  return json(
    {
      team_id: 'team-a',
      team_run_id: 'run-a',
      team_version: 1,
      run_version: 1,
      status: 'running',
      accepted_at: '2026-10-13T00:00:00Z',
      execution_mode: 'durable_control_only',
    },
    202
  )
}

function requestedInterrupt() {
  runFixture = {
    ...runFixture,
    status: 'interrupt_requested',
    run_version: 2,
    capabilities: {
      ...runFixture.capabilities,
      can_interrupt: false,
      interrupt_confirmation_pending: true,
    },
  }
  return json(runFixture)
}

function rememberRun() {
  const { workspace, actorId } = fixtureContext
  const scope = [
    'synapse',
    actorId,
    workspace.tenant_id,
    workspace.workspace_id,
    'teams',
    workspace.membership_version ?? 0,
  ]
  sessionStorage.setItem(
    `synapse:team-runs:${JSON.stringify(scope)}`,
    JSON.stringify({ 'team-a': { runId: 'run-a' } })
  )
}

function mutations(path?: string) {
  return requests.filter(
    (request) => request.method === 'POST' && (!path || request.path === path)
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

async function mountPage(): Promise<RenderResult> {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceTeamsPage />
    </QueryClientProvider>
  )
}

beforeEach(async () => {
  setLocale('zh-CN')
  sessionStorage.clear()
  fixtureContext.actorId = 'actor-a'
  fixtureContext.workspace = {
    workspace_id: '11',
    tenant_id: '7',
    name: 'Fixture Workspace',
    slug: 'fixture',
    icon: null,
    status: 'active',
    workspace_role: 'owner',
    membership_version: 3,
  }
  requests.length = 0
  overrides.clear()
  teamsFixture = [teamFixture()]
  runFixture = runningFixture()
  await page.viewport(1280, 900)
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input), window.location.href).pathname
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined
    requests.push({ method, path, headers, body })
    const override = overrides.get(`${method} ${path}`)
    if (override) return override()
    if (method === 'GET' && path === base)
      return json({ items: teamsFixture, total: teamsFixture.length })
    if (method === 'GET' && path === '/api/v1/ai/agent/')
      return json({
        agents: [{ id: 'agent-a', data: { name: 'Fixture agent' } }],
      })
    if (method === 'GET' && path === runPath) return json(runFixture)
    if (method === 'GET' && path === `${runPath}/events`)
      return json({
        items: [
          {
            event_id: 'fixture-event',
            sequence: 1,
            event_type:
              runFixture.status === 'interrupt_requested'
                ? 'interrupt_requested'
                : 'run_started',
            team_id: 'team-a',
            team_run_id: 'run-a',
            occurred_at: '2026-10-13T00:00:00Z',
            payload: { execution_mode: 'durable_control_only' },
          },
        ],
        total: 1,
      })
    if (method === 'POST' && path === `${base}/team-a/runs`) return accepted()
    if (method === 'POST' && path === `${runPath}/interrupt`)
      return requestedInterrupt()
    if (method === 'POST' && path === base) {
      const created = {
        ...teamFixture(),
        team_id: 'team-new',
        name: String(body?.name),
      }
      teamsFixture.push(created)
      return json(created, 201)
    }
    throw new Error(`No fixture response defined for ${method} ${path}`)
  })
})

afterEach(async () => {
  await cleanup()
  queryClient?.clear()
  vi.restoreAllMocks()
  sessionStorage.clear()
  setLocale('zh-CN')
})

describe('F27b team control UI with fixture APIs', () => {
  it.each(['viewer', 'member'] as const)(
    '%s cannot mutate even when a run exposes can_interrupt',
    async (role) => {
      fixtureContext.workspace.workspace_role = role
      rememberRun()
      const screen = await mountPage()
      await expect
        .element(screen.getByRole('status'))
        .toHaveTextContent('控制状态已保存')
      await expect
        .element(
          screen.getByText(
            '当前 Workspace 无权管理团队；可查看团队和运行快照。'
          )
        )
        .toBeVisible()
      await expect
        .element(screen.getByRole('button', { name: '创建草稿', exact: true }))
        .not.toBeInTheDocument()
      await expect
        .element(screen.getByRole('textbox', { name: '团队名称' }))
        .not.toBeInTheDocument()
      await expect
        .element(screen.getByRole('button', { name: '启动团队运行' }))
        .not.toBeInTheDocument()
      await expect
        .element(screen.getByRole('button', { name: '请求中断运行' }))
        .not.toBeInTheDocument()
      await expect
        .element(screen.getByText('Fixture task', { exact: true }))
        .toBeVisible()
      expect(mutations()).toHaveLength(0)
      expect(
        requests.some((request) => request.path === '/api/v1/ai/agent/')
      ).toBe(false)
    }
  )

  it.each(['owner', 'admin'] as const)(
    '%s can save a run, with pending UI and a persistent control-only notice',
    async (role) => {
      fixtureContext.workspace.workspace_role = role
      const pending = deferred<Response>()
      overrides.set(`POST ${base}/team-a/runs`, () => pending.promise)
      const screen = await mountPage()
      await expect
        .element(screen.getByRole('button', { name: '启动团队运行' }))
        .toBeEnabled()
      await expect
        .element(screen.getByText('仅记录控制请求 / 执行服务未接入'))
        .toBeVisible()
      await userEvent.click(
        screen.getByRole('button', { name: '启动团队运行' })
      )
      await expect
        .element(screen.getByRole('button', { name: '正在保存运行…' }))
        .toBeDisabled()
      pending.resolve(accepted())
      await expect
        .element(screen.getByRole('status'))
        .toHaveTextContent('控制状态已保存')
      await expect
        .element(screen.getByText('durable_control_only', { exact: true }))
        .not.toBeInTheDocument()
      await expect
        .element(screen.getByRole('progressbar', { name: '任务进度' }))
        .toHaveAttribute('aria-valuenow', '0')
      await expect
        .element(screen.getByRole('button', { name: '请求中断运行' }))
        .toBeEnabled()
      expect(mutations()).toHaveLength(1)
      expect(mutations()[0].body).toEqual({ team_version: 1 })
      expect(mutations()[0].headers.get('X-Workspace-ID')).toBe('11')
      expect(mutations()[0].headers.get('Idempotency-Key')).toMatch(/^web-/)

      await cleanup()
      queryClient.clear()
      const reopened = await mountPage()
      await expect
        .element(reopened.getByRole('status'))
        .toHaveTextContent('控制状态已保存')
      await expect
        .element(reopened.getByText('仅记录控制请求 / 执行服务未接入'))
        .toBeVisible()
      expect(mutations()).toHaveLength(1)
    }
  )

  it('requires keyboard confirmation, cancels without POST, and leaves interruption awaiting confirmation', async () => {
    rememberRun()
    const pending = deferred<Response>()
    overrides.set(`POST ${runPath}/interrupt`, () => pending.promise)
    const screen = await mountPage()
    const trigger = screen.getByRole('button', { name: '请求中断运行' })
    await expect.element(trigger).toBeEnabled()
    await userEvent.click(trigger)
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: '取消', exact: true }))
      .toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    expect(mutations(`${runPath}/interrupt`)).toHaveLength(0)

    await userEvent.keyboard('{Enter}')
    await expect
      .element(page.getByRole('button', { name: '取消', exact: true }))
      .toHaveFocus()
    await userEvent.keyboard('{Tab}{Enter}')
    await expect
      .element(page.getByRole('button', { name: '正在提交中断请求…' }))
      .toBeDisabled()
    await expect
      .element(page.getByRole('button', { name: '取消', exact: true }))
      .toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
    expect(mutations(`${runPath}/interrupt`)).toHaveLength(1)
    expect(mutations(`${runPath}/interrupt`)[0].body).toEqual({
      expected_run_version: 1,
    })
    pending.resolve(requestedInterrupt())
    await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('中断请求已提交，等待执行器确认')
    await expect.element(screen.getByRole('status')).toHaveFocus()
    await expect
      .element(
        screen.getByText(
          '中断请求尚未确认，不能视为任务已停止。当前未接入执行器。'
        )
      )
      .toBeVisible()
    await expect
      .element(screen.getByText('已中断', { exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '请求中断运行' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('region', { name: '任务进度' }))
      .toHaveTextContent('待处理')
  })

  it('keeps an interrupt failure in the dialog and allows an explicit retry', async () => {
    rememberRun()
    overrides.set(`POST ${runPath}/interrupt`, () =>
      json({ code: 'SERVICE_UNAVAILABLE', detail: 'fixture unavailable' }, 503)
    )
    const screen = await mountPage()
    await userEvent.click(screen.getByRole('button', { name: '请求中断运行' }))
    await userEvent.click(page.getByRole('button', { name: '确认中断请求' }))
    await expect
      .element(page.getByRole('alertdialog'))
      .toHaveTextContent('服务暂不可用，请稍后重试。')
    expect(runFixture.status).toBe('running')
    overrides.delete(`POST ${runPath}/interrupt`)
    await userEvent.click(page.getByRole('button', { name: '重试中断请求' }))
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('中断请求已提交，等待执行器确认')
    expect(mutations(`${runPath}/interrupt`)).toHaveLength(2)
  })

  it('distinguishes list errors from an empty list and retries without a mutation', async () => {
    overrides.set(`GET ${base}`, () =>
      json({ code: 'SERVICE_UNAVAILABLE' }, 503)
    )
    const screen = await mountPage()
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('服务暂不可用，请稍后重试。')
    await expect
      .element(screen.getByText('当前 Workspace 还没有团队。'))
      .not.toBeInTheDocument()
    overrides.delete(`GET ${base}`)
    await userEvent.click(screen.getByRole('button', { name: '重新加载团队' }))
    await expect
      .element(screen.getByRole('button', { name: '启动团队运行' }))
      .toBeEnabled()
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
    expect(mutations()).toHaveLength(0)
  })

  it('recovers an agent-list error and requires an explicit agent before creating a draft', async () => {
    overrides.set('GET /api/v1/ai/agent/', () =>
      json({ code: 'SERVICE_UNAVAILABLE' }, 503)
    )
    const screen = await mountPage()
    await expect
      .element(screen.getByRole('button', { name: '创建草稿', exact: true }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('服务暂不可用，请稍后重试。')
    overrides.delete('GET /api/v1/ai/agent/')
    await userEvent.click(
      screen.getByRole('button', { name: '重新加载智能体' })
    )
    await userEvent.fill(
      screen.getByRole('textbox', { name: '团队名称' }),
      'New fixture team'
    )
    await userEvent.fill(
      screen.getByRole('textbox', { name: '首个任务' }),
      'New fixture task'
    )
    await expect
      .element(screen.getByRole('button', { name: '创建草稿', exact: true }))
      .toBeDisabled()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '负责人智能体' }),
      'agent-a'
    )
    await userEvent.click(
      screen.getByRole('button', { name: '创建草稿', exact: true })
    )
    await expect
      .element(screen.getByRole('textbox', { name: '团队名称' }))
      .toHaveValue('')
    const request = mutations(base)[0]
    expect(request.body?.members).toEqual([
      { agent_id: 'agent-a', role: 'leader', is_leader: true },
    ])
    expect(request.body?.tasks).toEqual([
      expect.objectContaining({
        task_id: expect.stringMatching(/^task_/),
        owner_member_id: 'agent-a',
        subject: 'New fixture task',
      }),
    ])
    expect(mutations()).toHaveLength(1)
  })

  it('keeps the draft inputs after a duplicate-name conflict and allows renaming before retry', async () => {
    overrides.set(`POST ${base}`, () =>
      json({ code: 'CONFLICT', detail: 'Fixture duplicate name' }, 409)
    )
    const screen = await mountPage()
    await userEvent.fill(
      screen.getByRole('textbox', { name: '团队名称' }),
      'Duplicate fixture name'
    )
    await userEvent.fill(
      screen.getByRole('textbox', { name: '首个任务' }),
      'Fixture task'
    )
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '负责人智能体' }),
      'agent-a'
    )
    await userEvent.click(
      screen.getByRole('button', { name: '创建草稿', exact: true })
    )
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('你已创建同名团队，请更换团队名称。')
    await expect
      .element(screen.getByRole('textbox', { name: '团队名称' }))
      .toHaveValue('Duplicate fixture name')
    await expect
      .element(screen.getByRole('textbox', { name: '首个任务' }))
      .toHaveValue('Fixture task')
    overrides.delete(`POST ${base}`)
    await userEvent.fill(
      screen.getByRole('textbox', { name: '团队名称' }),
      'Unique fixture name'
    )
    await userEvent.click(
      screen.getByRole('button', { name: '创建草稿', exact: true })
    )
    await expect
      .element(screen.getByRole('textbox', { name: '团队名称' }))
      .toHaveValue('')
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
    expect(mutations(base)).toHaveLength(2)
    expect(mutations(base)[1].body?.name).toBe('Unique fixture name')
  })

  it('reuses the start idempotency key after a lost response instead of inventing a new run', async () => {
    overrides.set(`POST ${base}/team-a/runs`, () => {
      throw new TypeError('Fixture lost response after accepting run')
    })
    const screen = await mountPage()
    await userEvent.click(screen.getByRole('button', { name: '启动团队运行' }))
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('无法连接服务器，请检查网络后重试。')
    overrides.delete(`POST ${base}/team-a/runs`)
    await userEvent.click(screen.getByRole('button', { name: '重试启动' }))
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('控制状态已保存')
    const attempts = mutations(`${base}/team-a/runs`)
    expect(attempts).toHaveLength(2)
    expect(attempts[0].headers.get('Idempotency-Key')).toBe(
      attempts[1].headers.get('Idempotency-Key')
    )
  })

  it('retries an accepted run snapshot and event query without restarting the run', async () => {
    overrides.set(`GET ${runPath}`, () =>
      json({ code: 'SERVICE_UNAVAILABLE' }, 503)
    )
    const screen = await mountPage()
    await userEvent.click(screen.getByRole('button', { name: '启动团队运行' }))
    await expect
      .element(screen.getByRole('button', { name: '重新加载运行' }))
      .toBeEnabled()
    await expect
      .element(screen.getByRole('button', { name: '启动团队运行' }))
      .not.toBeInTheDocument()
    overrides.delete(`GET ${runPath}`)
    overrides.set(`GET ${runPath}/events`, () =>
      json({ code: 'SERVICE_UNAVAILABLE' }, 503)
    )
    await userEvent.click(screen.getByRole('button', { name: '重新加载运行' }))
    await expect
      .element(screen.getByRole('button', { name: '重新加载事件' }))
      .toBeEnabled()
    overrides.delete(`GET ${runPath}/events`)
    await userEvent.click(screen.getByRole('button', { name: '重新加载事件' }))
    await expect
      .element(screen.getByRole('region', { name: '运行事件' }))
      .toHaveTextContent('控制记录已创建')
    expect(mutations()).toHaveLength(1)
  })

  it('honors a false run capability and removes management controls after role downgrade', async () => {
    rememberRun()
    runFixture.capabilities.can_interrupt = false
    const screen = await mountPage()
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('控制状态已保存')
    await expect
      .element(screen.getByRole('button', { name: '请求中断运行' }))
      .not.toBeInTheDocument()
    fixtureContext.workspace = {
      ...fixtureContext.workspace,
      workspace_role: 'viewer',
    }
    await screen.rerender(
      <QueryClientProvider client={queryClient}>
        <WorkspaceTeamsPage />
      </QueryClientProvider>
    )
    await expect
      .element(screen.getByRole('textbox', { name: '团队名称' }))
      .not.toBeInTheDocument()
    expect(mutations()).toHaveLength(0)
  })

  it('isolates remembered runs by actor and membership version', async () => {
    rememberRun()
    const screen = await mountPage()
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('控制状态已保存')
    fixtureContext.actorId = 'actor-b'
    fixtureContext.workspace = {
      ...fixtureContext.workspace,
      workspace_role: 'member',
      membership_version: 4,
    }
    await screen.rerender(
      <QueryClientProvider client={queryClient}>
        <WorkspaceTeamsPage />
      </QueryClientProvider>
    )
    await expect.element(screen.getByRole('status')).toHaveTextContent('草稿')
    await expect
      .element(screen.getByRole('region', { name: '运行事件' }))
      .not.toBeInTheDocument()
    expect(mutations()).toHaveLength(0)
  })

  it('keeps readable controls and long identifiers inside a 390px viewport', async () => {
    await page.viewport(390, 844)
    rememberRun()
    const longId = `fixture-${'long-identifier-'.repeat(25)}`
    teamsFixture[0].members[0].agent_id = longId
    runFixture.members[0].agent_id = longId
    runFixture.tasks[0].owner_member_id = longId
    const screen = await mountPage()
    await expect
      .element(screen.getByRole('button', { name: '请求中断运行' }))
      .toBeEnabled()
    await expect
      .element(screen.getByRole('region', { name: '团队成员' }))
      .toHaveTextContent(longId)
    expect(document.querySelector('main')!.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth
    )
    await userEvent.click(screen.getByRole('button', { name: '请求中断运行' }))
    await expect
      .element(page.getByRole('button', { name: '确认中断请求' }))
      .toBeVisible()
    expect(
      document.querySelector('[role="alertdialog"]')!.getBoundingClientRect()
        .width
    ).toBeLessThanOrEqual(window.innerWidth)
    await userEvent.keyboard('{Escape}')
    expect(mutations()).toHaveLength(0)
  })

  it('localizes the owner flow, limitation, keyboard dialog, and pending result in English', async () => {
    setLocale('en')
    const screen = await mountPage()
    await expect
      .element(
        screen.getByRole('heading', { name: 'Sub-agent team', exact: true })
      )
      .toBeVisible()
    await expect
      .element(
        screen.getByText(
          'Control requests only / Execution service is not connected',
          { exact: true }
        )
      )
      .toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Start team run' })
    )
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('Control state saved')
    const main = document.querySelector('main')!
    const accessibleCopy = Array.from(
      main.querySelectorAll('input,select,[aria-label]')
    )
      .map(
        (element) =>
          `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('placeholder') ?? ''}`
      )
      .join(' ')
    expect(`${main.textContent} ${accessibleCopy}`).not.toMatch(
      /[\u3400-\u9fff]/
    )
    expect(main.textContent).not.toContain('durable_control_only')
    await userEvent.click(
      screen.getByRole('button', { name: 'Request interruption' })
    )
    await expect
      .element(
        page.getByRole('heading', { name: 'Confirm team interruption request' })
      )
      .toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Cancel', exact: true }))
      .toHaveFocus()
    expect(
      document.querySelector('[role="alertdialog"]')!.textContent
    ).not.toMatch(/[\u3400-\u9fff]/)
    await userEvent.click(
      page.getByRole('button', { name: 'Confirm interruption request' })
    )
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent(
        'Interruption requested; awaiting executor confirmation'
      )
    expect(main.textContent).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('localizes read-only permissions and retryable errors in English', async () => {
    setLocale('en')
    fixtureContext.workspace.workspace_role = 'viewer'
    overrides.set(`GET ${base}`, () =>
      json({ code: 'SERVICE_UNAVAILABLE' }, 503)
    )
    const screen = await mountPage()
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent(
        'The service is temporarily unavailable. Try again later.'
      )
    await expect
      .element(
        screen.getByText(
          'You can view teams and run snapshots, but cannot manage teams in this Workspace.'
        )
      )
      .toBeVisible()
    overrides.delete(`GET ${base}`)
    await userEvent.click(screen.getByRole('button', { name: 'Reload teams' }))
    await expect.element(screen.getByRole('status')).toHaveTextContent('Draft')
    expect(document.querySelector('main')!.textContent).not.toMatch(
      /[\u3400-\u9fff]/
    )
    expect(mutations()).toHaveLength(0)
  })
})
