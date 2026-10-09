import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')
const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()
page.setDefaultTimeout(20000)
page.on('pageerror', (error) => console.error('Browser page error:', error.message))

const setToken = async (token) => {
  await context.clearCookies()
  await context.addCookies([{ name: 'synapse_access_token', value: token, url: seed.web }])
}
const sessionsPath = (workspace) => `${seed.web}/w/${workspace}/sessions`
const control = async (path, body = {}) => {
  const response = await fetch(`${seed.proxy}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const text = await response.text()
  assert.equal(response.status, 200, text)
  return JSON.parse(text)
}
const apiRequest = async (path, workspace, method = 'GET') => {
  const response = await fetch(`${seed.proxy}${path}`, {
    method,
    headers: { Authorization: `Bearer ${seed.actor_token}`, 'X-Workspace-ID': workspace },
  })
  return { status: response.status, text: await response.text() }
}
const pickAgentAndSession = async (workspace, agentId, sessionName) => {
  await page.goto(sessionsPath(workspace))
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.getByLabel('智能体').selectOption(agentId)
  const row = page.getByRole('button', { name: new RegExp(sessionName) })
  await row.waitFor()
  await row.click()
  await page.getByRole('heading', { name: sessionName, exact: true }).waitFor()
}

try {
  await setToken(seed.actor_token)
  await pickAgentAndSession(seed.workspace_one, seed.agent_one, 'F25a Primary Session')
  await page.getByText('F25a committed history sentinel', { exact: true }).waitFor()

  // The first real API replay is cut after one delta. Retry replays the same
  // Redis event IDs/sequences; both kinds of duplicates must be ignored.
  await page.getByText('F25a alpha ', { exact: false }).waitFor()
  await page.getByText('消息流已断开', { exact: false }).waitFor()
  await page.getByRole('button', { name: '重试消息流', exact: true }).click()
  const completeDelta = page.getByText('F25a alpha beta gamma', { exact: true })
  await completeDelta.waitFor()
  assert.equal(await page.getByText('F25a alpha alpha beta beta gamma', { exact: true }).count(), 0)
  await page.getByText('消息流已断开', { exact: false }).waitFor()

  // A transient 503 on the retry keeps committed history and already-rendered
  // live text. The proxy does not synthesize any success event or mutate Redis.
  await control('/__f25a/fail-next')
  await page.getByRole('button', { name: '重试消息流', exact: true }).click()
  await page.getByText('HTTP 503', { exact: false }).waitFor()
  await page.getByText('F25a committed history sentinel', { exact: true }).waitFor()
  await completeDelta.waitFor()

  // Switching session and Workspace unmounts the old stream panel. A delayed
  // Redis delta for the old session must not appear in either new context.
  await page.getByRole('button', { name: /F25a Second Session/ }).click()
  await page.getByRole('heading', { name: 'F25a Second Session', exact: true }).waitFor()
  assert.equal(await page.getByText('F25a alpha beta gamma', { exact: true }).count(), 0)
  await control('/__f25a/publish', {
    session_id: seed.session_one,
    event: { type: 'TEXT_BLOCK_DELTA', reply_id: 'f25a-live-reply', sequence: 6, block_id: 'f25a-block', delta: 'F25a late old-session chunk' },
  })
  await page.waitForTimeout(300)
  assert.equal(await page.getByText('F25a late old-session chunk', { exact: false }).count(), 0)

  await pickAgentAndSession(seed.workspace_two, seed.agent_two, 'F25a Workspace Two Session')
  assert.equal(await page.getByText('F25a alpha beta gamma', { exact: true }).count(), 0)
  await control('/__f25a/publish', {
    session_id: seed.session_one,
    event: { type: 'TEXT_BLOCK_DELTA', reply_id: 'f25a-live-reply', sequence: 7, block_id: 'f25a-block', delta: 'F25a late cross-workspace chunk' },
  })
  await page.waitForTimeout(300)
  assert.equal(await page.getByText('F25a late cross-workspace chunk', { exact: false }).count(), 0)

  // Actual DELETE makes the subsequent real SSE endpoint return 404. The UI
  // must clear both transient text and cached history from this inaccessible scope.
  await pickAgentAndSession(seed.workspace_one, seed.agent_one, 'F25a Second Session')
  await page.getByText('F25a second committed sentinel', { exact: true }).waitFor()
  await page.getByText('消息流已断开', { exact: false }).waitFor()
  const deleted = await apiRequest(`/api/v1/ai/sessions/${encodeURIComponent(seed.session_second)}?agent_id=${encodeURIComponent(seed.agent_one)}`, seed.workspace_one, 'DELETE')
  assert.equal(deleted.status, 204, deleted.text)
  await page.getByRole('button', { name: '重试消息流', exact: true }).click()
  await page.getByText('当前会话已不可访问，消息内容已清除。', { exact: true }).waitFor()
  assert.equal(await page.getByText('F25a second committed sentinel', { exact: true }).count(), 0)

  // 403 comes from the actual gateway after member revocation. Seed the second
  // Workspace's live SSE stream through Redis, then revoke access before retry.
  await control('/__f25a/publish', {
    session_id: seed.session_two,
    event: { type: 'REPLY_START', reply_id: 'f25a-forbidden-reply', sequence: 1, name: 'F25a Agent Two' },
  })
  await control('/__f25a/publish', {
    session_id: seed.session_two,
    event: { type: 'TEXT_BLOCK_START', reply_id: 'f25a-forbidden-reply', sequence: 2, block_id: 'f25a-forbidden-block' },
  })
  await control('/__f25a/publish', {
    session_id: seed.session_two,
    event: { type: 'TEXT_BLOCK_DELTA', reply_id: 'f25a-forbidden-reply', sequence: 3, block_id: 'f25a-forbidden-block', delta: 'F25a forbidden scope secret' },
  })
  await pickAgentAndSession(seed.workspace_two, seed.agent_two, 'F25a Workspace Two Session')
  await page.getByText('F25a forbidden scope secret', { exact: true }).waitFor()
  await page.getByText('消息流已断开', { exact: false }).waitFor()
  await control('/__f25a/revoke', { workspace_id: seed.workspace_two, user_id: seed.actor_id })
  await page.getByRole('button', { name: '重试消息流', exact: true }).click()
  await page.getByText('当前会话已不可访问，消息内容已清除。', { exact: true }).waitFor()
  assert.equal(await page.getByText('F25a forbidden scope secret', { exact: false }).count(), 0)

  console.log('F25a SSE text frontend verification passed')
} finally {
  await browser.close()
}
