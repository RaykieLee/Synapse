import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')
const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch({ headless: true })
const managerContext = await browser.newContext()
await managerContext.addCookies([{ name: 'synapse_access_token', value: seed.manager_token, url: seed.web }])
const page = await managerContext.newPage()
page.setDefaultTimeout(12000)
page.on('console', (message) => { if (message.type() === 'error') console.error('Browser console error:', message.text()) })
page.on('response', (response) => {
  if (response.url().includes('/api/v1/')) console.log('API response', response.status(), response.url())
})
const requests = []
page.on('request', (request) => {
  if (request.url().includes('/roles') && ['POST', 'PATCH', 'DELETE'].includes(request.method())) {
    requests.push({ method: request.method(), url: request.url(), body: request.postDataJSON?.() ?? null })
  }
})
page.on('pageerror', (error) => console.error('Browser page error:', error.message))

try {
  // A single actor is owner in Tenant A and admin in Tenant B: list cache must follow tenantId.
  await page.goto(`${seed.web}/tenants/${seed.tenant_a_id}/roles`)
  try {
    await page.getByRole('heading', { name: '租户角色' }).waitFor()
  } catch (error) {
    console.error('First route debug:', page.url(), (await page.locator('body').innerText()).slice(0, 2000))
    throw error
  }
  await page.getByText('Alpha only sentinel').waitFor()
  assert.equal(await page.getByText('Beta only sentinel').count(), 0, 'Tenant A excludes Tenant B role')
  await page.goto(`${seed.web}/tenants/${seed.tenant_b_id}`)
  await page.getByRole('heading', { name: 'F12b Tenant B' }).waitFor()
  await page.getByRole('main').getByRole('link', { name: '角色管理' }).first().click()
  await page.getByRole('heading', { name: '租户角色' }).waitFor()
  await page.getByText('Beta only sentinel').waitFor()
  assert.equal(await page.getByText('Alpha only sentinel').count(), 0, 'Tenant B excludes cached Tenant A role')
  await page.goto(`${seed.web}/tenants/${seed.tenant_a_id}/roles`)
  await page.getByText('Alpha only sentinel').waitFor()
  assert.equal(await page.getByText('Beta only sentinel').count(), 0, 'returning to Tenant A does not leak Tenant B cache')

  // Search and server pagination use the API query parameters.
  const search = page.getByPlaceholder('搜索角色名称或标识')
  const searchResponse = page.waitForResponse((response) =>
    response.url().includes(`/tenants/${seed.tenant_a_id}/roles`) &&
    response.url().includes('search=Needle+search+target'),
  )
  await search.fill('Needle search target')
  await searchResponse
  await page.locator('tbody tr').filter({ hasText: 'Needle search target' }).waitFor()
  assert.equal(await page.locator('tbody tr').count(), 1)
  await search.fill('')
  await page.getByText('Alpha only sentinel').waitFor()
  await page.getByText('共 22 个角色').waitFor()
  await page.getByRole('button', { name: '下一页' }).click()
  await page.getByText('2 / 2').waitFor()
  assert.equal(await page.locator('tbody tr').count(), 2, 'page two displays the remaining two roles')
  await page.getByRole('button', { name: '上一页' }).click()
  await page.getByText('1 / 2').waitFor()

  // Create form serializes exactly the supported permission allowlist, with no global/workspace actions.
  await page.getByRole('button', { name: '创建角色' }).click()
  const editor = page.getByRole('dialog', { name: '创建角色' }).getByRole('form', { name: '创建角色' })
  await editor.getByLabel('角色名称').fill('UI verification role')
  await editor.getByLabel('角色标识').fill('ui_verification_role')
  await editor.getByRole('checkbox').nth(0).check()
  await editor.getByRole('checkbox').nth(3).check()
  await editor.getByRole('button', { name: '创建角色' }).click()
  const createdRow = page.locator('tr').filter({ hasText: 'UI verification role' })
  await createdRow.waitFor()
  const createRequest = requests.find((request) => request.method === 'POST' && request.url.endsWith(`/tenants/${seed.tenant_a_id}/roles`))
  assert.ok(createRequest, 'create request reached the real tenant-role endpoint')
  assert.deepEqual(Object.keys(createRequest.body).sort(), ['permissions', 'remark', 'role_key', 'role_name', 'role_sort', 'status'])
  assert.deepEqual(createRequest.body.permissions, ['tenant:read', 'tenant_member:manage'])
  assert.equal(createRequest.body.role_key, 'ui_verification_role')

  // Edit and status changes round-trip to PATCH; enabled/disabled filters reflect server state.
  await createdRow.getByRole('button', { name: '编辑' }).click()
  const editForm = page.getByRole('dialog', { name: '编辑角色' }).getByRole('form', { name: '编辑角色' })
  await editForm.getByLabel('角色名称').fill('UI verification role edited')
  await editForm.getByLabel('角色标识').fill('ui_verification_role_edited')
  await editForm.getByRole('button', { name: '保存角色' }).click()
  const editedRow = page.locator('tr').filter({ hasText: 'UI verification role edited' })
  await editedRow.waitFor()
  const patchRequest = requests.find((request) => request.method === 'PATCH' && request.url.includes(`/tenants/${seed.tenant_a_id}/roles/`))
  assert.ok(patchRequest && patchRequest.body.role_key === 'ui_verification_role_edited')
  await editedRow.getByRole('button', { name: '停用' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认停用' }).click()
  await page.getByLabel('角色状态筛选').selectOption('disabled')
  const disabledRow = page.locator('tr').filter({ hasText: 'UI verification role edited' })
  await disabledRow.waitFor()
  await disabledRow.getByRole('button', { name: '启用' }).waitFor()
  await page.getByLabel('角色状态筛选').selectOption('active')
  await disabledRow.waitFor({ state: 'detached' })
  await page.getByLabel('角色状态筛选').selectOption('')
  await page.locator('tr').filter({ hasText: 'UI verification role edited' }).waitFor()
  await page.locator('tr').filter({ hasText: 'UI verification role edited' }).getByRole('button', { name: '启用' }).click()
  await page.locator('tr').filter({ hasText: 'UI verification role edited' }).getByText('启用', { exact: true }).waitFor()

  // Server conflict is shown to the user instead of silently dropping the mutation error.
  await page.getByRole('button', { name: '创建角色' }).click()
  const duplicateForm = page.getByRole('dialog', { name: '创建角色' }).getByRole('form', { name: '创建角色' })
  await duplicateForm.getByLabel('角色名称').fill('Different name')
  await duplicateForm.getByLabel('角色标识').fill('ui_verification_role_edited')
  await duplicateForm.getByRole('button', { name: '创建角色' }).click()
  await page.getByRole('alert').getByText('当前租户已有相同角色名称或标识。').waitFor()
  await duplicateForm.getByRole('button', { name: '取消' }).click()

  // Soft delete is confirmed, sent as DELETE, and removes the row from subsequent API-backed rendering.
  const finalRow = page.locator('tr').filter({ hasText: 'UI verification role edited' })
  await finalRow.getByRole('button', { name: '删除' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认软删除' }).click()
  await finalRow.waitFor({ state: 'detached' })
  assert.ok(requests.some((request) => request.method === 'DELETE' && request.url.includes(`/tenants/${seed.tenant_a_id}/roles/`)))

  // Ordinary tenant members have no entry link and direct route/API attempts are rejected.
  const memberContext = await browser.newContext()
  await memberContext.addCookies([{ name: 'synapse_access_token', value: seed.member_token, url: seed.web }])
  const memberPage = await memberContext.newPage()
  memberPage.setDefaultTimeout(12000)
  await memberPage.goto(`${seed.web}/tenants/${seed.tenant_a_id}`)
  await memberPage.getByRole('heading', { name: 'F12b Tenant A' }).waitFor()
  assert.equal(await memberPage.getByRole('link', { name: '角色管理' }).count(), 0, 'tenant member has no role-management entry')
  await memberPage.goto(`${seed.web}/tenants/${seed.tenant_a_id}/roles`)
  await memberPage.getByRole('alert').getByText('仅租户所有者或管理员可以管理租户角色。').waitFor()
  assert.equal(await memberPage.getByRole('button', { name: '创建角色' }).count(), 0)
  const forbidden = await memberPage.evaluate(async ({ tenantId, token }) => {
    const response = await fetch(`/api/v1/tenants/${tenantId}/roles`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return response.status
  }, { tenantId: seed.tenant_a_id, token: seed.member_token })
  assert.equal(forbidden, 403, 'API remains authoritative for role list denial')
  await memberContext.close()

  console.log('F12b tenant role frontend verification passed')
} finally {
  await browser.close()
}
