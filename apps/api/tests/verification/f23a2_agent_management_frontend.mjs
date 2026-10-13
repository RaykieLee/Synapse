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
const agentsPath = (workspace) => `${seed.web}/w/${workspace}/agents`
const createAgent = async (name, prompt) => {
  await page.getByRole('button', { name: '新建智能体', exact: true }).click()
  await page.getByLabel('名称').fill(name)
  await page.getByLabel('系统提示词').fill(prompt)
  await page.getByRole('button', { name: '创建智能体', exact: true }).click()
  await page.getByRole('heading', { name, exact: true }).waitFor()
}
const closeAgentDetails = async () => {
  const details = page
    .locator('[data-slot="dialog-content"]')
    .filter({ hasText: '智能体详情' })
  if (await details.count()) {
    await details.locator('[data-slot="dialog-close"]').click()
    await details.waitFor({ state: 'detached' })
  }
}
const chooseWorkspace = async (name) => {
  await closeAgentDetails()
  const switcher = page.getByRole('button', { name: '选择工作区' })
  try {
    await switcher.click()
  } catch (error) {
    console.error(`Workspace switcher missing at ${page.url()}`)
    console.error((await page.locator('body').innerText()).slice(0, 2500))
    throw error
  }
  await page.getByPlaceholder('搜索空间或租户…').fill(name)
  await page.getByRole('option').filter({ hasText: name }).click()
}
try {
  await page.goto(agentsPath(seed.alpha_one))
  await page.getByRole('heading', { name: '智能体', exact: true }).waitFor()
  await page.getByText('还没有智能体').waitFor()

  await createAgent('F23a2 Alpha Agent', 'Alpha prompt: first version.')
  const alphaAgentId = await page.locator('p').filter({ hasText: /^ID：/ }).innerText().then((text) => text.replace('ID：', '').trim())
  assert.ok(alphaAgentId.startsWith('synapse-agent-t'))
  await page.locator('pre').filter({ hasText: 'Alpha prompt: first version.' }).waitFor()

  // Edit/detail and local validation feedback.
  await page.getByRole('button', { name: '编辑' }).click()
  await page.getByLabel('名称').fill('F23a2 Alpha Agent Edited')
  await page.getByLabel('系统提示词').fill('Alpha prompt: edited.')
  await page.getByRole('button', { name: '保存修改' }).click()
  await page.getByRole('heading', { name: 'F23a2 Alpha Agent Edited', exact: true }).waitFor()
  await page.locator('pre').filter({ hasText: 'Alpha prompt: edited.' }).waitFor()
  await page.getByRole('button', { name: '编辑' }).click()
  await page.getByLabel('上下文配置 JSON').fill('{broken')
  await page.getByRole('button', { name: '保存修改' }).click()
  await page.getByRole('alert').filter({ hasText: '上下文配置 必须是有效 JSON' }).waitFor()
  await page.getByRole('button', { name: '取消' }).click()

  // A direct foreign ID request is 404 even while the same actor belongs to
  // both tenants. Create its target in Beta first.
  await chooseWorkspace('Beta One')
  await page.goto(agentsPath(seed.beta_one))
  await page.getByRole('heading', { name: '智能体', exact: true }).waitFor()
  await page.getByText('还没有智能体').waitFor()
  await createAgent('F23a2 Beta Agent', 'Beta-only prompt.')
  const betaAgentId = await page.locator('p').filter({ hasText: /^ID：/ }).innerText().then((text) => text.replace('ID：', '').trim())
  assert.notEqual(betaAgentId, alphaAgentId)
  await page.locator('pre').filter({ hasText: 'Beta-only prompt.' }).waitFor()

  const foreignResponse = await page.evaluate(async ({ id, workspace, token }) => {
    const response = await fetch(`/api/v1/ai/agent/${encodeURIComponent(id)}`, { headers: { 'X-Workspace-ID': workspace, Authorization: `Bearer ${token}` } })
    return { status: response.status, body: await response.text() }
  }, { id: betaAgentId, workspace: seed.alpha_one, token: seed.actor_token })
  assert.equal(foreignResponse.status, 404, foreignResponse.body)
  const betaList = await page.evaluate(async ({ workspace, token }) => {
    const response = await fetch('/api/v1/ai/agent/', { headers: { 'X-Workspace-ID': workspace, Authorization: `Bearer ${token}` } })
    return { status: response.status, body: await response.json() }
  }, { workspace: seed.beta_one, token: seed.actor_token })
  assert.equal(betaList.status, 200)
  assert.ok(betaList.body.agents.find((agent) => agent.id === betaAgentId)?.editable)

  // Scope-keyed cache and component key clear both rows and unsaved draft on switch.
  await chooseWorkspace('Alpha One')
  await page.waitForURL(new RegExp(`/w/${seed.alpha_one}(?:/|$)`))
  await page.goto(agentsPath(seed.alpha_one))
  await page.getByRole('heading', { name: '智能体', exact: true }).waitFor()
  await page.getByRole('button', { name: /F23a2 Alpha Agent Edited/ }).click()
  await page.getByRole('heading', { name: 'F23a2 Alpha Agent Edited', exact: true }).waitFor()
  assert.equal(await page.getByText('F23a2 Beta Agent', { exact: true }).count(), 0)
  await closeAgentDetails()
  await page.getByRole('button', { name: '新建智能体', exact: true }).click()
  await page.getByLabel('名称').fill('Unsaved Alpha Draft')
  await page.getByRole('button', { name: '取消' }).click()
  await chooseWorkspace('Beta One')
  await page.goto(agentsPath(seed.beta_one))
  await page.getByRole('heading', { name: '智能体', exact: true }).waitFor()
  await page.getByRole('button', { name: /F23a2 Beta Agent/ }).click()
  await page.getByRole('heading', { name: 'F23a2 Beta Agent', exact: true }).waitFor()
  await closeAgentDetails()
  await page.getByRole('button', { name: '新建智能体', exact: true }).click()
  assert.equal(await page.getByLabel('名称').inputValue(), '', 'new scope starts with a clean draft')
  await page.getByRole('button', { name: '取消' }).click()
  await chooseWorkspace('Alpha One')
  await page.goto(agentsPath(seed.alpha_one))
  await page.getByRole('heading', { name: '智能体', exact: true }).waitFor()
  await page.getByRole('button', { name: /F23a2 Alpha Agent Edited/ }).click()
  await page.getByRole('heading', { name: 'F23a2 Alpha Agent Edited', exact: true }).waitFor()
  assert.equal(await page.getByText('F23a2 Beta Agent', { exact: true }).count(), 0)

  // A second actor sharing the Workspace gets an empty actor-private agent list.
  await setToken(seed.peer_token)
  await page.goto(agentsPath(seed.alpha_one))
  await page.getByRole('heading', { name: '智能体', exact: true }).waitFor()
  await page.getByText('还没有智能体').waitFor()
  assert.equal(await page.getByText('F23a2 Alpha Agent Edited', { exact: true }).count(), 0)

  // Restore owner token; the actor's own resource remains editable and delete works.
  await setToken(seed.actor_token)
  await page.goto(agentsPath(seed.alpha_one))
  await page.getByRole('heading', { name: '智能体', exact: true }).waitFor()
  await page.getByRole('button', { name: /F23a2 Alpha Agent Edited/ }).click()
  await page.getByRole('heading', { name: 'F23a2 Alpha Agent Edited', exact: true }).waitFor()
  await page.getByRole('button', { name: '删除' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认删除' }).click()
  await page.getByText('还没有智能体').waitFor()
  const afterDelete = await page.evaluate(async ({ workspace, token }) => {
    const response = await fetch('/api/v1/ai/agent/', { headers: { 'X-Workspace-ID': workspace, Authorization: `Bearer ${token}` } })
    return response.json()
  }, { workspace: seed.alpha_one, token: seed.actor_token })
  assert.ok(!afterDelete.agents.some((row) => row.id === alphaAgentId))

  console.log('F23a2 Agent management frontend verification passed')
} finally {
  await browser.close()
}
