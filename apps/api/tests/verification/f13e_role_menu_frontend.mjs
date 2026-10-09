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
page.setDefaultTimeout(15000)
const writes = []
const menuGrantStatuses = []
page.on('console', (message) => { if (message.type() === 'error') console.error('Browser console error:', message.text()) })
page.on('request', (request) => {
  if (request.method() === 'PUT' && request.url().includes('/roles/') && request.url().endsWith('/menus')) {
    writes.push({ url: request.url(), body: request.postDataJSON() })
  }
})
page.on('response', (response) => {
  if (response.url().includes('/roles/') && response.url().endsWith('/menus')) menuGrantStatuses.push(response.status())
})
page.on('pageerror', (error) => console.error('Browser page error:', error.message))

const roleRow = (name) => page.locator('tbody tr').filter({ hasText: name })
const checkboxFor = (name) => page.locator('label').filter({ hasText: name }).locator('input[type="checkbox"]')
const openRole = async (tenantId, roleName) => {
  if (!page.url().endsWith(`/tenants/${tenantId}/roles`)) await page.goto(`${seed.web}/tenants/${tenantId}/roles`)
  try {
    await page.getByRole('heading', { name: '租户角色' }).waitFor()
  } catch (error) {
    console.error('Role page debug:', page.url(), (await page.locator('body').innerText()).slice(0, 2400))
    throw error
  }
  await roleRow(roleName).getByRole('button', { name: '菜单授权' }).click()
  await page.getByRole('heading', { name: `${roleName} · 菜单授权` }).waitFor()
  await page.getByRole('button', { name: '保存授权' }).waitFor()
}
const closeEditor = async () => page.getByRole('button', { name: '关闭' }).click()

try {
  // Tenant A owner can read and edit the current tenant's actual menu tree and saved role grant.
  await openRole(seed.tenant_a_id, 'Alpha Menu Role')
  await page.getByRole('heading', { name: '不可重新勾选的历史授权' }).waitFor()
  assert.equal(await checkboxFor('Alpha Enabled One').isChecked(), true)
  assert.equal(await checkboxFor('Alpha Enabled Two').isChecked(), false)
  assert.equal(await checkboxFor('Alpha Disabled Menu').isDisabled(), true)
  assert.equal(await checkboxFor('Alpha Disabled Menu').isChecked(), false)
  await page.getByText(`已删除菜单（ID ${seed.a_deleted}）`, { exact: true }).waitFor()
  assert.equal(await checkboxFor('Alpha Deleted Menu').count(), 0, 'soft-deleted menu is absent from selectable tree')
  assert.equal(await checkboxFor('Beta Enabled One').count(), 0, 'Tenant B menu is absent from Tenant A tree')

  // Cause a stale-selection API failure after the tree was loaded; the page must explain it.
  const staleDisabled = await page.evaluate(async ({ tenantId, menuId, token }) => fetch(`/api/v1/tenants/${tenantId}/menus/${menuId}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '1' }),
  }).then((response) => response.status), { tenantId: seed.tenant_a_id, menuId: seed.a_stale, token: seed.manager_token })
  assert.equal(staleDisabled, 200, 'manager disables a menu after the editor loaded its old active state')
  await checkboxFor('Alpha Stale Menu').check()
  await page.getByRole('button', { name: '保存授权' }).click()
  await page.getByRole('alert').filter({ hasText: '角色或菜单不存在、已停用或不属于当前租户，请刷新后重试。' }).waitFor()
  assert.ok(menuGrantStatuses.includes(404), 'real API rejection reached visible error handling')
  assert.equal(await page.getByRole('heading', { name: 'Alpha Menu Role · 菜单授权' }).count(), 1, 'editor remains open after rejected save')
  await closeEditor()

  // A route reload confirms the disabled menu comes back from the real tree endpoint as non-selectable.
  await page.reload()
  await page.getByRole('heading', { name: '租户角色' }).waitFor()
  await openRole(seed.tenant_a_id, 'Alpha Menu Role')
  const staleCheckbox = checkboxFor('Alpha Stale Menu')
  await staleCheckbox.waitFor()
  assert.equal(await staleCheckbox.isDisabled(), true, 'disabled tree node cannot be reselected after reload')
  assert.equal(await checkboxFor('Alpha Disabled Menu').isDisabled(), true)
  assert.equal(await page.getByText(`已删除菜单（ID ${seed.a_deleted}）`, { exact: true }).count(), 1)

  // Persist a replacement. Historical disabled/deleted grants are omitted; the body contains only active Tenant A IDs.
  await checkboxFor('Alpha Enabled One').uncheck()
  await checkboxFor('Alpha Enabled Two').check()
  const requestCountBeforeSave = writes.length
  await page.getByRole('button', { name: '保存授权' }).click()
  await page.getByRole('heading', { name: '租户角色' }).waitFor()
  const alphaSave = writes.slice(requestCountBeforeSave).find((request) => request.url.includes(`/tenants/${seed.tenant_a_id}/roles/${seed.role_a}/menus`))
  assert.deepEqual(alphaSave?.body?.menu_ids, [seed.a_two], 'save sends the selected active menu only')

  // Reload the actual route and confirm the saved grant round-trips from the API.
  await page.reload()
  await page.getByRole('heading', { name: '租户角色' }).waitFor()
  await roleRow('Alpha Menu Role').getByRole('button', { name: '菜单授权' }).click()
  await page.getByRole('heading', { name: 'Alpha Menu Role · 菜单授权' }).waitFor()
  assert.equal(await checkboxFor('Alpha Enabled One').isChecked(), false)
  assert.equal(await checkboxFor('Alpha Enabled Two').isChecked(), true)
  assert.equal(await page.getByRole('heading', { name: '不可重新勾选的历史授权' }).count(), 0, 'saving the replacement removed old disabled/deleted links')
  await closeEditor()

  // The other role in this tenant has a separate grant and does not inherit Alpha Menu Role's draft.
  await roleRow('Alpha Second Role').getByRole('button', { name: '菜单授权' }).click()
  await page.getByRole('heading', { name: 'Alpha Second Role · 菜单授权' }).waitFor()
  assert.equal(await checkboxFor('Alpha Enabled One').isChecked(), true)
  assert.equal(await checkboxFor('Alpha Enabled Two').isChecked(), false)
  await closeEditor()

  // The same user is an admin in Tenant B. Role, menu tree, and grant caches remain tenant-scoped.
  await page.goto(`${seed.web}/tenants/${seed.tenant_b_id}/roles`)
  await page.getByRole('heading', { name: '租户角色' }).waitFor()
  await roleRow('Beta Menu Role').waitFor()
  assert.equal(await page.getByText('Alpha Menu Role').count(), 0)
  await roleRow('Beta Menu Role').getByRole('button', { name: '菜单授权' }).click()
  await page.getByRole('heading', { name: 'Beta Menu Role · 菜单授权' }).waitFor()
  assert.equal(await checkboxFor('Beta Enabled One').isChecked(), true)
  assert.equal(await checkboxFor('Beta Enabled Two').isChecked(), false)
  assert.equal(await checkboxFor('Alpha Enabled One').count(), 0)
  await checkboxFor('Beta Enabled One').uncheck()
  await checkboxFor('Beta Enabled Two').check()
  const betaRequestCount = writes.length
  await page.getByRole('button', { name: '保存授权' }).click()
  await page.getByRole('heading', { name: '租户角色' }).waitFor()
  const betaSave = writes.slice(betaRequestCount).find((request) => request.url.includes(`/tenants/${seed.tenant_b_id}/roles/${seed.role_b}/menus`))
  assert.deepEqual(betaSave?.body?.menu_ids, [seed.b_two])

  await openRole(seed.tenant_a_id, 'Alpha Menu Role')
  assert.equal(await checkboxFor('Alpha Enabled Two').isChecked(), true, 'returning to Alpha restores its saved grant')
  assert.equal(await checkboxFor('Beta Enabled Two').count(), 0)

  // A normal member is blocked by the page and by direct GET/PUT API calls.
  const memberContext = await browser.newContext()
  await memberContext.addCookies([{ name: 'synapse_access_token', value: seed.member_token, url: seed.web }])
  const memberPage = await memberContext.newPage()
  memberPage.setDefaultTimeout(15000)
  await memberPage.goto(`${seed.web}/tenants/${seed.tenant_a_id}/roles`)
  await memberPage.getByRole('alert').getByText('仅租户所有者或管理员可以管理租户角色。').waitFor()
  assert.equal(await memberPage.getByRole('button', { name: '菜单授权' }).count(), 0)
  const memberApi = await memberPage.evaluate(async ({ tenantId, roleId, menuId, token }) => {
    const url = `/api/v1/tenants/${tenantId}/roles/${roleId}/menus`
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const get = await fetch(url, { headers })
    const put = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ menu_ids: [menuId] }) })
    return [get.status, put.status]
  }, { tenantId: seed.tenant_a_id, roleId: seed.role_a, menuId: seed.a_one, token: seed.member_token })
  assert.deepEqual(memberApi, [403, 403])

  console.log('F13e role-menu frontend verification passed')
} finally {
  await browser.close()
}
