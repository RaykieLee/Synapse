import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()
page.setDefaultTimeout(15000)
const setToken = async (token) => {
  await context.clearCookies()
  await context.addCookies([{ name: 'synapse_access_token', value: token, url: seed.web }])
}
const ownRow = () => page.locator('tbody tr').filter({ hasText: 'f12e-member' })
const otherRow = () => page.locator('tbody tr').filter({ hasText: 'f12e-other-a' })
const gotoTenant = async (tenantId, heading) => {
  await page.goto(`${seed.web}/tenants/${tenantId}`)
  await page.getByRole('heading', { name: heading }).waitFor()
  await ownRow().waitFor()
}
const goBack = async () => {
  await page.getByRole('link', { name: /返回租户列表/ }).click()
  await page.getByRole('heading', { name: '租户管理' }).waitFor()
}
const openTenant = async (name) => {
  await page.locator('tbody tr').filter({ hasText: name }).getByRole('link', { name: '查看详情' }).click()
  await page.getByRole('heading', { name }).waitFor()
  await ownRow().waitFor()
}

try {
  await setToken(seed.actor_token)
  await gotoTenant(seed.tenant_a_id, seed.tenant_a_name)
  await assert.doesNotReject(() => ownRow().getByText(seed.role_a_name, { exact: true }).waitFor(), 'ordinary member sees own assigned Tenant A role')
  assert.equal(await ownRow().getByRole('combobox').count(), 0, 'self row has no assignment control')
  assert.equal(await ownRow().getByRole('button').count(), 0, 'self row has no revoke control')
  assert.equal(await otherRow().getByText('需租户管理员读取').count(), 1, 'another member assignment remains hidden')
  assert.equal(await page.locator('select[aria-label*="自定义角色"]').count(), 0, 'member sees no custom-role management selectors')
  assert.equal(await page.getByRole('button', { name: '撤销' }).count(), 0, 'member sees no role-revoke actions')

  // Manager mutations exercise unassigned display without granting the browser actor write access.
  const revoke = await page.evaluate(async ({ tenantId, actorId, token }) => fetch(`/api/v1/tenants/${tenantId}/members/${actorId}/custom-role`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  }).then((response) => response.status), { tenantId: seed.tenant_a_id, actorId: seed.actor_id, token: seed.owner_a_token })
  assert.equal(revoke, 204)
  await page.reload()
  await page.getByRole('heading', { name: seed.tenant_a_name }).waitFor()
  await ownRow().getByText('未分配', { exact: true }).waitFor()
  assert.equal(await page.locator('select[aria-label*="自定义角色"]').count(), 0)
  const assign = await page.evaluate(async ({ tenantId, actorId, roleId, token }) => fetch(`/api/v1/tenants/${tenantId}/members/${actorId}/custom-role`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role_id: roleId }),
  }).then((response) => response.status), { tenantId: seed.tenant_a_id, actorId: seed.actor_id, roleId: seed.role_a_id, token: seed.owner_a_token })
  assert.equal(assign, 200)
  await page.reload()
  await ownRow().getByText(seed.role_a_name, { exact: true }).waitFor()

  // Same actor, same cached component, distinct tenant keys and role values across SPA navigation.
  await goBack()
  await openTenant(seed.tenant_b_name)
  await ownRow().getByText(seed.role_b_name, { exact: true }).waitFor()
  assert.equal(await ownRow().getByText(seed.role_a_name, { exact: true }).count(), 0, 'Tenant A role did not leak through query cache')
  assert.equal(await ownRow().getByRole('combobox').count(), 0)
  await goBack()
  await openTenant(seed.tenant_a_name)
  await ownRow().getByText(seed.role_a_name, { exact: true }).waitFor()
  assert.equal(await ownRow().getByText(seed.role_b_name, { exact: true }).count(), 0, 'returning to Tenant A restores its own role')
  console.log('F12e self-role view browser verification passed')
} finally {
  await browser.close()
}
