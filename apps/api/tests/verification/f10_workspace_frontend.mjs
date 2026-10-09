import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
await context.addCookies([{ name: 'synapse_access_token', value: seed.actor_token, url: seed.web }])
const page = await context.newPage()
page.setDefaultTimeout(12000)
page.on('pageerror', (error) => console.error('Browser page error:', error.message))
const pathIs = (id) => new RegExp(`/w/${id}(?:/|$)`).test(new URL(page.url()).pathname)
const choose = async (name) => {
  await page.getByRole('button', { name: '选择工作区' }).click()
  const search = page.getByPlaceholder('搜索空间或租户…')
  await search.fill(name)
  await page.getByRole('option').filter({ hasText: name }).click()
}
try {
  await page.goto(`${seed.web}/w/${seed.alpha_one}`)
  await page.getByRole('heading', { name: 'Alpha One' }).waitFor()
  assert.equal(pathIs(seed.alpha_one), true, 'initial authorized Workspace URL')

  // Switcher groups by tenant; searches across workspace and tenant names.
  await page.getByRole('button', { name: '选择工作区' }).click()
  await page.locator('[cmdk-group-heading]').getByText('Alpha Tenant').waitFor()
  await page.locator('[cmdk-group-heading]').getByText('Beta Tenant').waitFor()
  await page.getByPlaceholder('搜索空间或租户…').fill('Beta One')
  await page.getByRole('option').filter({ hasText: 'Beta One' }).click()
  await page.getByRole('heading', { name: 'Beta One' }).waitFor()
  assert.equal(pathIs(seed.beta_one), true, 'switcher navigates between tenant groups')
  await choose('Alpha Two')
  await page.getByRole('heading', { name: 'Alpha Two' }).waitFor()
  assert.equal(pathIs(seed.alpha_two), true, 'switcher search selects matching Workspace')

  // Members query cache remains scoped to workspace: same account, different tenant data.
  await page.goto(`${seed.web}/w/${seed.alpha_one}/members`)
  await page.getByRole('heading', { name: '空间成员' }).waitFor()
  await page.getByText('Alpha Owner').waitFor()
  assert.equal(await page.getByText('Beta Owner').count(), 0, 'Alpha member query does not show Beta data')
  await page.goto(`${seed.web}/w/${seed.beta_one}/members`)
  await page.getByRole('heading', { name: '空间成员' }).waitFor()
  await page.getByText('Beta Owner').waitFor()
  assert.equal(await page.getByText('Alpha Owner').count(), 0, 'Beta member query does not show Alpha data')

  // Create a workspace from the upper-left switcher; creator is an owner.
  await page.getByRole('button', { name: '选择工作区' }).click()
  await page.getByRole('option').filter({ hasText: '创建空间' }).click()
  await page.getByRole('heading', { name: '创建 Workspace' }).waitFor()
  await page.getByLabel('所属租户').selectOption(seed.alpha_id)
  await page.getByLabel('名称').fill('UI Created Space')
  await page.getByLabel('标识').fill('ui-created-space')
  await page.getByRole('button', { name: '创建空间', exact: true }).click()
  await page.getByRole('heading', { name: 'UI Created Space' }).waitFor()
  const createdId = new URL(page.url()).pathname.match(/^\/w\/([^/]+)/)?.[1]
  assert.ok(createdId && createdId !== seed.alpha_one, 'create flow navigates to newly created Workspace')

  // Add a tenant member to this space, then transfer ownership to that active space member.
  await page.goto(`${seed.web}/w/${createdId}/members`)
  await page.getByRole('heading', { name: '空间成员' }).waitFor()
  await page.getByLabel('用户 ID', { exact: true }).fill(seed.collab_id)
  await page.getByRole('button', { name: '加入空间' }).click()
  await page.getByText('Collaborator').waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  const collaboratorRow = page.locator('tr').filter({ hasText: 'Collaborator' })
  await collaboratorRow.getByRole('button', { name: '转移所有权' }).click()
  await page.waitForFunction(async ({ workspaceId, collaboratorId, token }) => {
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/members?page=1&page_size=20`, { headers: { 'X-Workspace-ID': workspaceId, 'Authorization': `Bearer ${token}` } })
    if (!response.ok) return false
    const data = await response.json()
    return data.items.some((item) => item.user_id === collaboratorId && item.workspace_role === 'owner')
  }, { workspaceId: createdId, collaboratorId: seed.collab_id, token: seed.actor_token })
  const memberResponse = await page.evaluate(async ({ workspaceId, token }) => {
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/members?page=1&page_size=20`, { headers: { 'X-Workspace-ID': workspaceId, 'Authorization': `Bearer ${token}` } })
    return response.json()
  }, { workspaceId: createdId, token: seed.actor_token })
  assert.equal(memberResponse.items.find((item) => item.user_id === seed.collab_id)?.workspace_role, 'owner')
  assert.equal(memberResponse.items.find((item) => item.user_id === seed.actor_id)?.workspace_role, 'admin')

  // Archive and restore; archived management remains reachable to the new workspace admin.
  await page.goto(`${seed.web}/w/${createdId}/settings`)
  await page.getByRole('heading', { name: 'UI Created Space' }).waitFor()
  await page.getByRole('heading', { name: '归档空间' }).waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '归档空间' }).click()
  await page.getByRole('button', { name: '恢复空间' }).waitFor()
  await page.getByRole('button', { name: '恢复空间' }).click()
  await page.getByRole('button', { name: '归档空间' }).waitFor()

  // Direct URL to a non-member's Workspace must fall back to an accessible URL.
  await page.goto(`${seed.web}/w/${seed.gamma_secret}`)
  await page.getByRole('heading', { name: /Alpha One|Alpha Two|Beta One/ }).waitFor()
  assert.equal(new URL(page.url()).pathname.includes(seed.gamma_secret), false, 'unauthorized direct URL was rejected')

  // Record a recent Alpha location, revoke Alpha tenant membership via its owner, then verify fallback and key cleanup.
  await page.goto(`${seed.web}/w/${seed.alpha_one}`)
  await page.getByRole('heading', { name: 'Alpha One' }).waitFor()
  const recentBefore = await page.evaluate((userId) => JSON.parse(localStorage.getItem(`synapse:recent-workspace:${userId}`) ?? 'null'), seed.actor_id)
  assert.equal(recentBefore?.workspace_id, seed.alpha_one)
  const revoke = await page.evaluate(async ({ tenantId, targetUserId, ownerToken }) => {
    const response = await fetch(`/api/v1/tenants/${tenantId}/members/${targetUserId}`, {
      method: 'PATCH', headers: { 'Authorization': `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'removed' }),
    })
    return { status: response.status, body: await response.text() }
  }, { tenantId: seed.alpha_id, targetUserId: seed.actor_id, ownerToken: seed.owner_token })
  assert.equal(revoke.status, 200, revoke.body)
  await page.goto(`${seed.web}/w/${seed.alpha_one}`)
  await page.getByRole('heading', { name: 'Beta One' }).waitFor()
  assert.equal(pathIs(seed.beta_one), true, 'revoked recent workspace falls back to another accessible space')
  const recentAfter = await page.evaluate((userId) => localStorage.getItem(`synapse:recent-workspace:${userId}`), seed.actor_id)
  assert.notEqual(recentAfter && JSON.parse(recentAfter).workspace_id, seed.alpha_one, 'revoked recent ID is not restored')

  console.log('F10 workspace frontend verification passed')
} finally {
  await browser.close()
}
