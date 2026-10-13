import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')
const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const setToken = async (token) => {
  await context.clearCookies()
  await context.addCookies([{ name: 'synapse_access_token', value: token, url: seed.web }])
}
await setToken(seed.actor_token)
const page = await context.newPage()
page.setDefaultTimeout(15000)
page.on('pageerror', (error) => console.error('Browser page error:', error.message))
const sessionsPath = (workspace) => `${seed.web}/w/${workspace}/sessions`
const closeSessionDetails = async () => {
  const details = page
    .locator('[data-slot="dialog-content"]')
    .filter({ hasText: '会话信息' })
  if (await details.count()) {
    await details.locator('[data-slot="dialog-close"]').click()
    await details.waitFor({ state: 'detached' })
  }
}
const chooseWorkspace = async (name) => {
  await closeSessionDetails()
  await page.getByRole('button', { name: '选择工作区' }).click()
  await page.getByPlaceholder('搜索空间或租户…').fill(name)
  await page.getByRole('option').filter({ hasText: name }).click()
}
const fetchApi = async (path, workspace, token = seed.actor_token) => page.evaluate(async ({ path, workspace, token }) => {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}`, 'X-Workspace-ID': workspace } })
  return { status: response.status, text: await response.text() }
}, { path, workspace, token })

try {
  await page.goto(sessionsPath(seed.alpha_one))
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.getByLabel('智能体').selectOption(seed.alpha_agent_id)
  await page.getByText('F24a Team Read Only Session', { exact: true }).waitFor()

  // Create a user session using the real session API from the UI.
  await page.getByRole('button', { name: '新建会话', exact: true }).click()
  await page.getByLabel('会话名称').fill('F24a Alpha User Session')
  await page.getByRole('button', { name: '创建会话', exact: true }).click()
  await page.getByRole('heading', { name: 'F24a Alpha User Session', exact: true }).waitFor()
  assert.ok((await page.locator('p').filter({ hasText: /^ID：synapse-s/ }).innerText()).includes(seed.actor_id))
  const alphaListResponse = await fetchApi(`/api/v1/ai/sessions/?agent_id=${encodeURIComponent(seed.alpha_agent_id)}`, seed.alpha_one)
  assert.equal(alphaListResponse.status, 200, alphaListResponse.text)
  const alphaSessions = JSON.parse(alphaListResponse.text).sessions
  const alphaSessionId = alphaSessions.find((row) => row.session.config.name === 'F24a Alpha User Session')?.session.id
  assert.ok(alphaSessionId, 'UI-created session is persisted and listed by the API')

  // Rename and change permission mode, then verify list/detail reflect server state.
  await page.getByRole('button', { name: '重命名 / 配置' }).click()
  await page.getByLabel('会话名称').fill('F24a Alpha Renamed')
  await page.getByLabel('工具权限模式').selectOption('explore')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.getByRole('heading', { name: 'F24a Alpha Renamed', exact: true }).waitFor()
  await page.getByText('explore', { exact: true }).waitFor()
  const updatedList = JSON.parse((await fetchApi(`/api/v1/ai/sessions/?agent_id=${encodeURIComponent(seed.alpha_agent_id)}`, seed.alpha_one)).text).sessions
  const updated = updatedList.find((row) => row.session.id === alphaSessionId)
  assert.equal(updated.session.config.name, 'F24a Alpha Renamed')
  assert.equal(updated.session.state.permission_context?.mode, 'explore')

  // A Beta session cannot be directly fetched under Alpha's verified Workspace.
  const foreign = await fetchApi(`/api/v1/ai/sessions/${encodeURIComponent(seed.beta_session_id)}/status?agent_id=${encodeURIComponent(seed.beta_agent_id)}`, seed.alpha_one)
  assert.equal(foreign.status, 404, foreign.text)

  // Team-origin sessions remain view-only in the UI.
  await closeSessionDetails()
  await page.getByRole('button', { name: /F24a Team Read Only Session/ }).click()
  await page.getByRole('heading', { name: 'F24a Team Read Only Session', exact: true }).waitFor()
  await page.getByText('此会话由系统流程或团队创建，仅可查看', { exact: false }).waitFor()
  assert.equal(await page.getByRole('button', { name: '重命名 / 配置' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '删除', exact: true }).count(), 0)

  // A genuine Redis session lock drives the API's running state and disables edits.
  await closeSessionDetails()
  await page.getByRole('button', { name: /F24a Running Session/ }).click()
  await page.getByRole('heading', { name: 'F24a Running Session', exact: true }).waitFor()
  await page.locator('dd').filter({ hasText: '运行中' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '重命名 / 配置' }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '删除', exact: true }).isDisabled(), true)

  // The scope key and keyed page discard an unsaved dialog and session selection.
  await closeSessionDetails()
  await page.getByRole('button', { name: /F24a Alpha Renamed/ }).click()
  await page.getByRole('heading', { name: 'F24a Alpha Renamed', exact: true }).waitFor()
  await closeSessionDetails()
  await page.getByRole('button', { name: '新建会话', exact: true }).click()
  await page.getByLabel('会话名称').fill('Unsaved Alpha Session Draft')
  // Use the workspace route while the modal is open (the modal intentionally
  // traps focus, so the sidebar switcher is not interactive at this moment).
  await page.goto(sessionsPath(seed.beta_one))
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.getByLabel('智能体').selectOption(seed.beta_agent_id)
  await page.getByText('F24a Foreign Beta Session', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('会话名称').count(), 0, 'scope switch closes and clears the unsaved dialog')
  assert.equal(await page.getByText('F24a Alpha Renamed', { exact: true }).count(), 0, 'Alpha session does not leak into Beta')
  await page.getByRole('button', { name: /F24a Foreign Beta Session/ }).click()
  await page.getByRole('heading', { name: 'F24a Foreign Beta Session', exact: true }).waitFor()
  await chooseWorkspace('Alpha One')
  await page.goto(sessionsPath(seed.alpha_one))
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.getByLabel('智能体').selectOption(seed.alpha_agent_id)
  await page.getByText('F24a Alpha Renamed', { exact: true }).waitFor()
  assert.equal(await page.getByText('F24a Foreign Beta Session', { exact: true }).count(), 0)

  // Shared Workspace membership alone does not disclose actor-private agents/sessions.
  await setToken(seed.peer_token)
  await page.goto(sessionsPath(seed.alpha_one))
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.getByRole('heading', { name: '请先创建智能体', exact: true }).waitFor()
  assert.equal(await page.getByText('F24a Alpha Renamed', { exact: true }).count(), 0)

  // Restore the actor and remove the UI-created manual session.
  await setToken(seed.actor_token)
  await page.goto(sessionsPath(seed.alpha_one))
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.getByLabel('智能体').selectOption(seed.alpha_agent_id)
  await page.getByRole('button', { name: /F24a Alpha Renamed/ }).click()
  await page.getByRole('heading', { name: 'F24a Alpha Renamed', exact: true }).waitFor()
  const deletedRow = page.getByRole('button', { name: /F24a Alpha Renamed/ })
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认删除' }).click()
  await deletedRow.waitFor({ state: 'detached' })
  const afterDelete = JSON.parse((await fetchApi(`/api/v1/ai/sessions/?agent_id=${encodeURIComponent(seed.alpha_agent_id)}`, seed.alpha_one)).text).sessions
  assert.ok(!afterDelete.some((row) => row.session.id === alphaSessionId), 'manual session is removed from backend listing')
  assert.ok(afterDelete.some((row) => row.session.id === seed.team_session_id), 'read-only team session remains')

  console.log('F24a Session management frontend verification passed')
} finally {
  await browser.close()
}
