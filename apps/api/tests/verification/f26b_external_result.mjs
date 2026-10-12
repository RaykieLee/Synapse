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

const sessionsPath = (workspace) => `${seed.web}/w/${workspace}/sessions`
const control = async (path, body = {}) => {
  const response = await fetch(`${seed.proxy}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  assert.equal(response.status, 200, text)
  return JSON.parse(text)
}
const setMode = (mode) => control('/__f26b/chat-mode', { mode })
const setToken = async () => {
  await context.clearCookies()
  await context.addCookies([{ name: 'synapse_access_token', value: seed.actor_token, url: seed.web }])
}
const selectSession = async (workspace, agentId, sessionName) => {
  await page.goto(sessionsPath(workspace))
  if (page.url().includes('/sign-in')) {
    await page.goto(sessionsPath(workspace))
  }
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.getByLabel('智能体').selectOption(agentId)
  const row = page.getByRole('button', { name: new RegExp(sessionName) })
  await row.waitFor()
  await row.click()
  await page.getByRole('heading', { name: sessionName, exact: true }).waitFor()
}
const externalRegion = () => page.getByRole('region', { name: '外部任务结果' })
const openPending = async (workspace, sessionName, agentId = seed.agent_id) => {
  await selectSession(workspace, agentId, sessionName)
  const region = externalRegion()
  await region.waitFor()
  await region.getByText('等待提交外部任务结果', { exact: true }).waitFor()
  return region
}
const cardFor = (region, toolName) => region.locator('article').filter({ hasText: toolName })
let failures = 0
const submitSuccess = async (workspace, sessionName, toolName, output) => {
  const region = await openPending(workspace, sessionName)
  const card = cardFor(region, toolName)
  await card.getByLabel('外部任务说明 / 结果').fill(output)
  await setMode('pass')
  await card.getByRole('button', { name: '提交结果', exact: true }).click()
  await assert.poll(async () => await region.getByRole('button', { name: '提交结果', exact: true }).count(), { timeout: 20000 }).rejects.toThrow()
}

try {
  await setToken()

  // Historical submitted tool calls restore the awaiting_external_result card.
  const initial = await openPending(seed.workspace_one, 'F26b Pending Success')
  const initialCard = cardFor(initial, 'F26b external success')
  await initialCard.getByText('等待外部结果', { exact: true }).waitFor()
  await initialCard.getByText('查看脱敏任务参数摘要', { exact: true }).click()
  await initialCard.getByText('"token":"[已隐藏]"', { exact: false }).waitFor()
  assert.equal(await initialCard.getByText('f26b-secret', { exact: false }).count(), 0)
  const emptySubmit = initialCard.getByRole('button', { name: '提交结果', exact: true })
  assert.equal(await emptySubmit.isDisabled(), true)

  // Successful result uses the real FastAPI /ai/chat/ route; the proxy only
  // records the payload and lets the response continue through to the UI.
  const initialInput = initialCard.locator('textarea')
  await initialInput.focus()
  await initialInput.evaluate((element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(element, value)
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, 'F26b external result accepted')
  const inputAccepted = await initialInput.inputValue() === 'F26b external result accepted'
  if (!inputAccepted) {
    failures += 1
    console.error('F26b FAIL: external-result textarea resets to empty and keeps submit disabled')
  }
  let calls = await control('/__f26b/chat-calls')
  if (inputAccepted) {
    await setMode('pass')
    await initialCard.getByRole('button', { name: '提交结果', exact: true }).click()
    await initialCard.getByText('正在提交…', { exact: true }).waitFor()
    await page.waitForTimeout(600)
    assert.equal(await initialCard.getByRole('button', { name: '提交结果', exact: true }).count(), 0)
    calls = await control('/__f26b/chat-calls')
    const successCall = calls.calls.at(-1)
    assert.equal(successCall.input.type, 'EXTERNAL_EXECUTION_RESULT')
    assert.equal(successCall.input.execution_results[0].id, seed.tool_success)
    assert.equal(successCall.input.execution_results[0].state, 'success')
    assert.equal(successCall.input.execution_results[0].output, 'F26b external result accepted')
  }

  // Cancellation is sent as an interrupted ToolResultBlock and clears the card.
  const cancelRegion = await openPending(seed.workspace_one, 'F26b Pending Cancel')
  const cancelCard = cardFor(cancelRegion, 'F26b external cancel')
  await setMode('pass')
  await cancelCard.getByRole('button', { name: '取消外部任务', exact: true }).click()
  await page.waitForTimeout(600)
  assert.equal(await cancelCard.getByRole('button', { name: '取消外部任务', exact: true }).count(), 0)
  calls = await control('/__f26b/chat-calls')
  const cancelCall = calls.calls.at(-1)
  assert.equal(cancelCall.input.type, 'EXTERNAL_EXECUTION_RESULT')
  assert.equal(cancelCall.input.execution_results[0].state, 'interrupted')
  assert.equal(cancelCall.input.execution_results[0].output, '外部任务已由用户取消。')

  // Expired/failed submissions are blocked by the reproduced input defect.
  // Keep their fixtures for a follow-up run after the UI issue is fixed.

  // Workspace/session isolation: the other Workspace has its own pending card,
  // while the first Workspace's tool request never appears there.
  const otherRegion = await openPending(seed.workspace_two, 'F26b Workspace Two Pending', seed.agent_two_id)
  await otherRegion.getByText('F26b external workspace-two', { exact: true }).waitFor()
  assert.equal(await otherRegion.getByText('F26b external success', { exact: true }).count(), 0)
  assert.equal(await otherRegion.getByText('F26b external cancel', { exact: true }).count(), 0)

  // Revoke the current actor from Workspace One. A reload must clear the
  // previously visible session and reject the old scope rather than leaking it.
  await control('/__f26b/revoke', { workspace_id: seed.workspace_one, user_id: seed.actor_id })
  await page.goto(`${seed.web}/w/${seed.workspace_one}/sessions`)
  await page.waitForTimeout(1200)
  assert.equal(await page.getByText('F26b external success', { exact: true }).count(), 0)
  assert.equal(await page.getByText('等待提交外部任务结果', { exact: true }).count(), 0)
  assert.ok(await page.getByText(/成员|权限|无法|不存在|读取/).count() > 0)

} finally {
  await browser.close()
}
if (failures) {
  console.error(`F26b external result frontend verification failed: ${failures} assertion(s)`)
  process.exitCode = 1
} else {
  console.log('F26b external result frontend verification passed')
}
