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
const messageResponses = []
page.on('pageerror', (error) => console.error('Browser page error:', error.message))
page.on('response', async (response) => {
  if (!new URL(response.url()).pathname.includes('/messages')) return
  const entry = { status: response.status(), url: response.url() }
  if (response.status() >= 400) {
    try { entry.body = (await response.text()).slice(0, 500) } catch {}
  }
  messageResponses.push(entry)
  console.log('F24b message API response:', JSON.stringify(entry))
})
const setToken = async (token) => {
  await context.clearCookies()
  await context.addCookies([{ name: 'synapse_access_token', value: token, url: seed.web }])
}
const sessionsPath = (workspace) => `${seed.web}/w/${workspace}/sessions`
const fetchApi = async (path, workspace, token = seed.actor_token, method = 'GET') => page.evaluate(async ({ path, workspace, token, method }) => {
  const response = await fetch(path, { method, headers: { Authorization: `Bearer ${token}`, 'X-Workspace-ID': workspace } })
  return { status: response.status, text: await response.text() }
}, { path, workspace, token, method })

try {
  await setToken(seed.actor_token)
  await page.goto(sessionsPath(seed.alpha_one))
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.waitForFunction(() => ['zh-CN', 'en'].includes(document.documentElement.lang))
  console.log('F24b browser locale:', JSON.stringify(await page.evaluate(() => ({
    documentLang: document.documentElement.lang,
    storedLocale: localStorage.getItem('synapse-locale'),
  }))))
  await page.getByLabel('智能体').selectOption(seed.alpha_agent_id)
  const primaryRow = page.getByRole('button', { name: /F24b Primary Session/ })
  await primaryRow.waitFor()
  await primaryRow.click()
  await page.getByRole('heading', { name: 'F24b Primary Session', exact: true }).waitFor()

  // The history page is backed by real AgentScope Redis records, with two roles and 62 entries.
  await page.getByText('F24b history 60 user', { exact: true }).waitFor()
  await page.getByText('F24b history 61 assistant', { exact: true }).waitFor()
  assert.equal(await page.getByText('F24b oldest pagination sentinel', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '加载更早消息', exact: true }).click()
  await page.getByText('F24b oldest pagination sentinel', { exact: true }).waitFor()
  assert.ok(await page.getByText('f24b-reference.txt', { exact: true }).count() >= 1, 'history renders data-block attachment name')

  // Session ID / agent scope checks are also exercised directly against FastAPI.
  const foreignSession = await fetchApi(`/api/v1/ai/sessions/${encodeURIComponent(seed.beta_session_id)}/messages?agent_id=${encodeURIComponent(seed.beta_agent_id)}&limit=50`, seed.alpha_one)
  assert.equal(foreignSession.status, 404, foreignSession.text)
  const wrongAgent = await fetchApi(`/api/v1/ai/sessions/${encodeURIComponent(seed.alpha_session_id)}/messages?agent_id=${encodeURIComponent(seed.beta_agent_id)}&limit=50`, seed.alpha_one)
  assert.equal(wrongAgent.status, 404, `mismatched agent_id must not expose Alpha messages: ${wrongAgent.text.slice(0, 500)}`)
  assert.ok(!wrongAgent.text.includes('F24b history 60 user'), 'mismatched agent_id response must not contain Alpha message content')
  assert.ok(!wrongAgent.text.includes('F24b history 61 assistant'), 'mismatched agent_id response must not contain Alpha message content')

  // Switch session and verify its distinct history does not reuse the first session's query data.
  await page.getByRole('button', { name: /F24b Second Session/ }).click()
  await page.getByRole('heading', { name: 'F24b Second Session', exact: true }).waitFor()
  await page.getByText('F24b second session unique sentinel', { exact: true }).waitFor()
  assert.equal(await page.getByText('F24b oldest pagination sentinel', { exact: true }).count(), 0)
  await page.getByRole('button', { name: /F24b Primary Session/ }).click()
  await page.getByRole('heading', { name: 'F24b Primary Session', exact: true }).waitFor()
  await page.getByText('F24b history 61 assistant', { exact: true }).waitFor()

  // First send is deliberately rejected at the network edge. Draft and selected attachment must remain.
  const composerLabel = await page.locator('textarea[data-slot="textarea"][aria-label]').getAttribute('aria-label')
  assert.ok(['输入消息', 'Type a message'].includes(composerLabel), `unexpected composer accessible name: ${composerLabel}`)
  const composer = page.getByRole('textbox', { name: composerLabel, exact: true })
  try {
    await page.waitForFunction((label) => {
      const input = [...document.querySelectorAll('textarea[data-slot="textarea"]')]
        .find((element) => element.getAttribute('aria-label') === label)
      return input instanceof HTMLTextAreaElement && !input.disabled && input.getClientRects().length > 0
    }, composerLabel, { timeout: 15000 })
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      url: location.href,
      documentLang: document.documentElement.lang,
      storedLocale: localStorage.getItem('synapse-locale'),
      textareas: [...document.querySelectorAll('textarea')].map((input) => ({
        ariaLabel: input.getAttribute('aria-label'),
        placeholder: input.placeholder,
        disabled: input.disabled,
        visible: input.getClientRects().length > 0,
      })),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent),
      bodyText: document.body.innerText.slice(-2500),
    }))
    console.error('F24b composer was not enabled; DOM snapshot:', JSON.stringify(snapshot))
    console.error('F24b message API responses:', JSON.stringify(messageResponses))
    throw error
  }
  assert.equal(await composer.isEnabled(), true, 'message composer should be enabled before filling')
  await composer.fill('F24b retry message text')
  await page.getByText('引用 Workspace 附件', { exact: false }).click()
  const attachmentLabel = page.locator('label').filter({ hasText: 'f24b-reference.txt' })
  await attachmentLabel.locator('input[type="checkbox"]').check()
  let failedOnce = false
  let capturedAcceptedBody = null
  await page.route('**/api/v1/ai/chat/**', async (route) => {
    if (!failedOnce) {
      failedOnce = true
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'fixture transient failure' }) })
      return
    }
    capturedAcceptedBody = route.request().postDataJSON()
    await route.continue()
  })
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'fixture transient failure' }).waitFor()
  assert.equal(await composer.inputValue(), 'F24b retry message text')
  assert.equal(await attachmentLabel.locator('input[type="checkbox"]').isChecked(), true)

  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.waitForFunction((label) => {
    const input = [...document.querySelectorAll('textarea[data-slot="textarea"]')]
      .find((element) => element.getAttribute('aria-label') === label)
    return input instanceof HTMLTextAreaElement && input.value === ''
  }, composerLabel)
  assert.equal(failedOnce, true)
  assert.equal(capturedAcceptedBody?.session_id, seed.alpha_session_id)
  assert.equal(capturedAcceptedBody?.input?.content?.[0]?.text, 'F24b retry message text')
  const sentData = capturedAcceptedBody?.input?.content?.find((block) => block.type === 'data')
  assert.equal(sentData?.name, 'f24b-reference.txt')
  assert.equal(sentData?.source?.type, 'base64')
  assert.equal(sentData?.source?.data, 'RjI0YiBhdHRhY2htZW50IGZpeHR1cmUgYm9keQ==')
  assert.ok(await page.getByRole('heading', { name: 'F24b Primary Session', exact: true }).count())

  // An Alpha actor's Agent/Session/messages do not appear under another Workspace.
  await page.goto(sessionsPath(seed.alpha_two))
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.getByLabel('智能体').selectOption(seed.alpha_two_agent_id)
  await page.getByRole('button', { name: /F24b Alpha Two Session/ }).click()
  await page.getByRole('heading', { name: 'F24b Alpha Two Session', exact: true }).waitFor()
  await page.getByText('F24b Alpha Two unique sentinel', { exact: true }).waitFor()
  assert.equal(await page.getByText('F24b history 61 assistant', { exact: true }).count(), 0)
  const crossWorkspace = await fetchApi(`/api/v1/ai/sessions/${encodeURIComponent(seed.alpha_session_id)}/messages?agent_id=${encodeURIComponent(seed.alpha_agent_id)}&limit=50`, seed.alpha_two)
  assert.equal(crossWorkspace.status, 404, crossWorkspace.text)

  // Same Workspace member initially sees only their own AgentScope data. Revocation removes live access and cached content.
  await setToken(seed.peer_token)
  await page.goto(sessionsPath(seed.alpha_one))
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.getByLabel('智能体').selectOption(seed.peer_agent_id)
  await page.getByRole('button', { name: /F24b Peer Session/ }).click()
  await page.getByRole('heading', { name: 'F24b Peer Session', exact: true }).waitFor()
  await page.getByText('F24b revoked peer cache sentinel', { exact: true }).waitFor()
  await setToken(seed.actor_token)
  const removal = await fetchApi(`/api/v1/workspaces/${seed.alpha_one}/members/${seed.peer_id}`, seed.alpha_one, seed.actor_token, 'DELETE')
  assert.ok([200, 204].includes(removal.status), removal.text)
  await setToken(seed.peer_token)
  await page.reload()
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor().catch(() => {})
  assert.equal(await page.getByText('F24b revoked peer cache sentinel', { exact: true }).count(), 0, 'revoked member content is not rendered after route reload')
  const revokedMessages = await fetchApi(`/api/v1/ai/sessions/${encodeURIComponent(seed.peer_session_id)}/messages?agent_id=${encodeURIComponent(seed.peer_agent_id)}&limit=50`, seed.alpha_one, seed.peer_token)
  assert.ok([403, 404].includes(revokedMessages.status), revokedMessages.text)

  console.log('F24b chat messages frontend verification passed')
} finally {
  await browser.close()
}
