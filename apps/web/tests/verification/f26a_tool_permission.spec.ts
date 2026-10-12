import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import type { Page, Route } from 'playwright'

const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

type Seed = {
  web: string
  proxy: string
  actor_token: string
  workspace_id: string
  agent_id: string
  session_id: string
  tool_call_id: string
  reply_id: string
}

const seed = JSON.parse(fs.readFileSync(process.argv[2] ?? process.env.F26A_SEED ?? '', 'utf8')) as Seed
const browserCandidates = [
  process.env.F26A_CHROMIUM_PATH,
  'C:/Users/Lenovo/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  'C:/Users/Lenovo/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
].filter((value): value is string => Boolean(value && fs.existsSync(value)))
const browser = await chromium.launch({
  headless: false,
  slowMo: 40,
  ...(browserCandidates[0] ? { executablePath: browserCandidates[0] } : {}),
})
const context = await browser.newContext()
let page = await context.newPage()
const reportVerificationLog = (message: string) => {
  // Verification output is intentionally visible in the command-line run.
  // eslint-disable-next-line no-console
  console.log(message)
}
const reportPageError = (message: string) => {
  // Browser errors are part of the verification diagnostics.
  // eslint-disable-next-line no-console
  console.error(message)
}
const configurePage = (target: Page) => {
  target.setDefaultTimeout(20000)
  target.on('pageerror', (error: Error) => reportPageError(`F26A page error: ${error.message}`))
}
configurePage(page)

const sessionsPath = `${seed.web}/w/${seed.workspace_id}/sessions`
const control = async (path: string, body: Record<string, unknown> = {}) => {
  const response = await fetch(`${seed.proxy}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  assert.equal(response.status, 200, text)
  return JSON.parse(text) as Record<string, unknown>
}

const apiFetch = async (path: string, body: unknown, method = 'POST') => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
  const response = await fetch(`${seed.proxy}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${seed.actor_token}`,
      'X-Workspace-ID': seed.workspace_id,
      'Content-Type': 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
    signal: controller.signal,
  })
    return { status: response.status, text: await response.text() }
  } finally {
    clearTimeout(timeout)
  }
}

const openSession = async () => {
  await page.goto(sessionsPath, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.getByLabel('智能体').selectOption(seed.agent_id)
  await page.getByRole('button', { name: /F26a Permission Session/ }).click()
  await page.getByRole('heading', { name: 'F26a Permission Session', exact: true }).waitFor()
}

const openFreshSession = async () => {
  const previous = page
  page = await context.newPage()
  configurePage(page)
  await openSession()
  await previous.close()
}

const confirmation = () => page.getByRole('region', { name: '工具权限确认' })
const requestCard = () => confirmation().getByRole('article').filter({ hasText: 'F26a sensitive_tool' })

type ToolCall = {
  id: string
  name: string
  input: string
  state: string
}

type AllowRequest = {
  agent_id: string
  session_id: string
  input: {
    type: string
    reply_id: string
    confirm_results: Array<{
      confirmed: boolean
      tool_call: ToolCall
    }>
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

const isAllowRequest = (value: unknown): value is AllowRequest => {
  if (!isRecord(value) || typeof value.agent_id !== 'string' || typeof value.session_id !== 'string') {
    return false
  }
  if (!isRecord(value.input)
    || typeof value.input.type !== 'string'
    || typeof value.input.reply_id !== 'string'
    || !Array.isArray(value.input.confirm_results)
    || value.input.confirm_results.length === 0) {
    return false
  }
  const result = value.input.confirm_results[0]
  if (!isRecord(result) || typeof result.confirmed !== 'boolean' || !isRecord(result.tool_call)) {
    return false
  }
  return typeof result.tool_call.id === 'string'
    && typeof result.tool_call.name === 'string'
    && typeof result.tool_call.input === 'string'
    && typeof result.tool_call.state === 'string'
}

try {
  await context.addCookies([{ name: 'synapse_access_token', value: seed.actor_token, url: seed.web }])
  await openSession()

  // The list/status and history are real AgentScope Redis-backed records.
  await page.getByText('等待授权', { exact: true }).first().waitFor()
  await page.getByText('需要确认工具操作', { exact: true }).waitFor()
  await confirmation().getByText('F26a sensitive_tool', { exact: true }).waitFor()
  await confirmation().getByText('查看脱敏参数摘要', { exact: true }).click()
  await confirmation().getByText('[已隐藏]', { exact: false }).waitFor()
  assert.equal(await page.getByText('F26a should-not-leak-token', { exact: true }).count(), 0)
  reportVerificationLog('F26a initial awaiting state and redaction passed')

  // Duplicate replay of the same REQUIRE_USER_CONFIRM event must not create
  // a second card.
  await control('/__f26a/publish', {
    session_id: seed.session_id,
    event: {
      id: 'f26a-require',
      type: 'REQUIRE_USER_CONFIRM',
      reply_id: seed.reply_id,
      tool_calls: [{
        type: 'tool_call',
        id: seed.tool_call_id,
        name: 'F26a sensitive_tool',
        input: '{"token":"F26a should-not-leak-token","path":"/tmp/f26a"}',
        state: 'asking',
      }],
    },
  })
  await page.waitForTimeout(300)
  assert.equal(await requestCard().count(), 1)
  reportVerificationLog('F26a duplicate SSE event de-duplication passed')

  // Allow uses the real FastAPI chat endpoint. The control endpoint only
  // updates the Redis fixture to the post-resume state and publishes the
  // corresponding real SSE result event.
  const allowBody = {
    agent_id: seed.agent_id,
    session_id: seed.session_id,
    input: {
      type: 'USER_CONFIRM_RESULT',
      reply_id: seed.reply_id,
      confirm_results: [{
        confirmed: true,
        tool_call: {
          type: 'tool_call',
          id: seed.tool_call_id,
          name: 'F26a sensitive_tool',
          input: '{"token":"F26a should-not-leak-token","path":"/tmp/f26a"}',
          state: 'asking',
        },
      }],
    },
  }
  let capturedAllow: AllowRequest | null = null
  await page.route('**/api/v1/ai/chat/**', async (route: Route) => {
    const payload: unknown = route.request().postDataJSON()
    assert.ok(isAllowRequest(payload))
    capturedAllow = payload
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'started', session_id: seed.session_id }),
    })
  })
  reportVerificationLog('F26a submitting allow response with captured frontend request')
  await requestCard().getByRole('button', { name: '允许并继续', exact: true }).click()
  await page.waitForTimeout(300)
  assert.equal(capturedAllow?.agent_id, allowBody.agent_id)
  assert.equal(capturedAllow?.session_id, allowBody.session_id)
  assert.equal(capturedAllow?.input?.type, allowBody.input.type)
  assert.equal(capturedAllow?.input?.reply_id, allowBody.input.reply_id)
  assert.equal(capturedAllow?.input?.confirm_results?.[0]?.confirmed, true)
  assert.equal(capturedAllow?.input?.confirm_results?.[0]?.tool_call?.id, seed.tool_call_id)
  assert.equal(capturedAllow?.input?.confirm_results?.[0]?.tool_call?.name, 'F26a sensitive_tool')
  assert.equal(capturedAllow?.input?.confirm_results?.[0]?.tool_call?.input, allowBody.input.confirm_results[0].tool_call.input)
  reportVerificationLog('F26a allow request body and controlled 200 response passed')
  await control('/__f26a/resolve', { confirmed: true })
  await page.waitForTimeout(500)
  assert.equal(await requestCard().count(), 0)
  await openFreshSession()
  const timeline = page.getByRole('region', { name: '工具执行时间线' })
  await timeline.getByText('成功', { exact: true }).waitFor()
  await timeline.getByText('查看脱敏工具结果', { exact: false }).click()
  await timeline.getByText('F26a tool completed', { exact: true }).waitFor()
  reportVerificationLog('F26a allow state recovery passed')

  // A second identical event is already covered above; after resolution the
  // UI has removed the request key and cannot submit it again.
  await page.unroute(/\/api\/v1\/ai\/chat(?:\/|$)/)

  // Invalid scope/agent is rejected by the real FastAPI status gateway and
  // does not expose run state.
  const invalid = await apiFetch(
    `/api/v1/ai/sessions/${encodeURIComponent(seed.session_id)}/status?agent_id=synapse-agent-from-another-scope`,
    null,
    'GET',
  )
  assert.ok([404, 403].includes(invalid.status), invalid.text)
  reportVerificationLog(`F26a invalid scope response: ${invalid.status}`)

  // Re-seed a second asking request and exercise the UI's real error state.
  await control('/__f26a/reset-asking')
  await openFreshSession()
  await page.getByText('需要确认工具操作', { exact: true }).waitFor()

  let intercepted = false
  await page.route(/\/api\/v1\/ai\/chat(?:\/|$)/, async (route: Route) => {
    reportVerificationLog(`F26a stale route: ${route.request().url()}`)
    if (!intercepted) {
      intercepted = true
      await route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({ code: 'CONFLICT', detail: 'fixture stale confirmation' }),
      })
      return
    }
    await route.continue()
  })
  await requestCard().getByRole('button', { name: '拒绝', exact: true }).click()
  await page.waitForTimeout(1000)
  assert.equal(intercepted, true)
  await page.getByText('确认请求已失效，消息与运行状态已刷新。', { exact: true }).waitFor()
  assert.equal(await requestCard().getByRole('button', { name: '拒绝', exact: true }).count(), 1)

  // Refresh behavior: the persisted asking state reconstructs the card after
  // a full page refresh; it is not only a transient SSE artifact.
  await page.unroute(/\/api\/v1\/ai\/chat(?:\/|$)/)
  await control('/__f26a/reset-asking')
  await openFreshSession()
  await page.getByText('需要确认工具操作', { exact: true }).waitFor()

  reportVerificationLog('F26a tool permission frontend verification passed')
} finally {
  await browser.close()
}
