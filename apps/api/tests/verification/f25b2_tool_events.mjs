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
  await pickAgentAndSession(seed.workspace_one, seed.agent_one, 'F25b2 Primary Session')
  await page.getByText('F25b2 committed history sentinel', { exact: true }).waitFor()

  const timeline = page.getByRole('region', { name: '工具执行时间线' })
  await timeline.waitFor()
  const historyCard = timeline.locator('article').filter({ hasText: 'history_lookup' })
  const liveCard = timeline.locator('article').filter({ hasText: 'live_lookup' })
  const errorCard = timeline.locator('article').filter({ hasText: 'failing_lookup' })
  await historyCard.getByText('history_lookup', { exact: true }).waitFor()
  assert.ok(await timeline.getByText('成功', { exact: true }).count() >= 2)
  await historyCard.getByText('查看脱敏参数摘要', { exact: true }).click()
  await historyCard.getByText(/"token"\s*:\s*"\[已隐藏\]"/).waitFor()
  await historyCard.getByText('查看脱敏工具结果', { exact: true }).click()
  await historyCard.getByText('history result Bearer [已隐藏]', { exact: true }).waitFor()
  assert.equal(await timeline.getByText('history-token', { exact: false }).count(), 0)

  await liveCard.getByText('live_lookup', { exact: true }).waitFor()
  await errorCard.getByText('failing_lookup', { exact: true }).waitFor()
  assert.ok(await timeline.getByText('成功', { exact: true }).count() >= 2)
  await liveCard.getByText('查看脱敏工具结果', { exact: true }).click()
  console.log('live tool card:', await liveCard.innerText())
  await timeline.getByText('失败', { exact: true }).waitFor()
  await errorCard.getByText('查看脱敏工具结果', { exact: true }).click()
  await errorCard.locator('pre').filter({ hasText: /tool failed: token=\[已隐藏\]/ }).waitFor()
  assert.equal(await timeline.getByText('error-secret', { exact: false }).count(), 0)
  // The API stream is real and Redis-backed; leaving it idle lets the proxy
  // close after replay, proving the UI keeps the rendered timeline on close.
  await page.getByText('消息流已断开', { exact: false }).waitFor()
  assert.equal(await liveCard.getByText(/live result Bearer \[已隐藏\]/).count(), 1)

  console.log('F25b2 tool event frontend verification passed')
} finally {
  await browser.close()
}
