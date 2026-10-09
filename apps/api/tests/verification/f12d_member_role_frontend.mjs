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
  if (token) await context.addCookies([{ name: 'synapse_access_token', value: token, url: seed.web }])
}
const memberRow = () => page.locator('tbody tr').filter({ hasText: 'f12d-member' })
const roleSelect = () => page.getByLabel('f12d-member自定义角色')
const waitRole = async (roleId) => page.waitForFunction(({ memberName, expected }) => {
  const select = [...document.querySelectorAll('select[aria-label]')].find((node) => node.getAttribute('aria-label') === `${memberName}自定义角色`)
  return select?.value === expected
}, { memberName: 'f12d-member', expected: roleId })
const selectRole = async (roleId) => {
  await roleSelect().selectOption(roleId)
  await waitRole(roleId)
}
const gotoTenant = async (tenantId, heading) => {
  await page.goto(`${seed.web}/tenants/${tenantId}`)
  await page.getByRole('heading', { name: heading }).waitFor()
  await roleSelect().waitFor()
}
const tenantRowsLinkTo = (tenantName) => page.locator('tbody tr').filter({ hasText: tenantName }).getByRole('link', { name: '查看详情' })
const backToTenantList = async () => {
  await page.getByRole('link', { name: /返回租户列表/ }).click()
  await page.getByRole('heading', { name: '租户管理' }).waitFor()
}

try {
  await setToken(seed.actor_token)
  await gotoTenant(seed.tenant_a_id, 'F12d Tenant Alpha')
  const alphaSelect = roleSelect()
  assert.equal(await alphaSelect.inputValue(), seed.alpha_reviewer_id, 'owner reads the existing Tenant A assignment')
  const alphaOptions = await alphaSelect.locator('option').allTextContents()
  assert.ok(alphaOptions.includes('Alpha Reviewer'))
  assert.ok(alphaOptions.includes('Alpha Editor'))
  assert.ok(!alphaOptions.includes('Alpha Disabled'), 'disabled tenant role is absent from assignment choices')
  assert.ok(!alphaOptions.includes('Beta Auditor') && !alphaOptions.includes('Beta Editor'), 'Tenant B roles do not leak into Tenant A choices')

  // Tenant A owner replaces and revokes the assigned role through the UI.
  await selectRole(seed.alpha_editor_id)
  await selectRole(seed.alpha_reviewer_id)
  await memberRow().getByRole('button', { name: '撤销' }).click()
  await waitRole('')
  assert.equal(await memberRow().getByRole('button', { name: '撤销' }).count(), 0)
  await selectRole(seed.alpha_editor_id)
  assert.equal(await memberRow().getByLabel('f12d-member角色').inputValue(), 'member', 'custom role assignment leaves the built-in tenant role unchanged')

  // Same actor and same target user, but a different tenant-scoped cached assignment.
  await backToTenantList()
  await tenantRowsLinkTo('F12d Tenant Beta').click()
  await page.getByRole('heading', { name: 'F12d Tenant Beta' }).waitFor()
  await roleSelect().waitFor()
  assert.equal(await roleSelect().inputValue(), seed.beta_auditor_id, 'admin sees the distinct Tenant B assignment after SPA navigation')
  const betaOptions = await roleSelect().locator('option').allTextContents()
  assert.ok(betaOptions.includes('Beta Auditor') && betaOptions.includes('Beta Editor'))
  assert.ok(!betaOptions.includes('Alpha Reviewer') && !betaOptions.includes('Alpha Editor'), 'Tenant A roles do not leak into Tenant B choices')

  // Built-in tenant admin on Tenant B can assign, replace and revoke as well.
  await selectRole(seed.beta_editor_id)
  await selectRole(seed.beta_auditor_id)
  await memberRow().getByRole('button', { name: '撤销' }).click()
  await waitRole('')
  await selectRole(seed.beta_editor_id)

  await backToTenantList()
  await tenantRowsLinkTo('F12d Tenant Alpha').click()
  await page.getByRole('heading', { name: 'F12d Tenant Alpha' }).waitFor()
  await roleSelect().waitFor()
  assert.equal(await roleSelect().inputValue(), seed.alpha_editor_id, 'returning to Tenant A restores its own assignment rather than Tenant B state')

  // Race boundary: active options were loaded, then an administrator disables one in the real API.
  // The stale option can trigger a request, which must be rejected and surfaced to the manager.
  const disabledUpdate = await page.evaluate(async ({ tenantId, roleId }) => {
    const token = document.cookie.split('; ').find((value) => value.startsWith('synapse_access_token='))?.split('=').slice(1).join('=')
    const response = await fetch(`/api/v1/tenants/${tenantId}/roles/${roleId}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })
    return response.status
  }, { tenantId: seed.tenant_a_id, roleId: seed.alpha_reviewer_id })
  assert.equal(disabledUpdate, 200, 'owner disables the role through the tenant-role API')
  await roleSelect().selectOption(seed.alpha_reviewer_id)
  await page.getByRole('alert').filter({ hasText: 'RESOURCE_NOT_FOUND' }).waitFor()
  assert.equal(await roleSelect().inputValue(), seed.alpha_editor_id, 'failed stale assignment leaves current role selected')
  await page.reload()
  await page.getByRole('heading', { name: 'F12d Tenant Alpha' }).waitFor()
  await roleSelect().waitFor()
  const reloadedOptions = await roleSelect().locator('option').evaluateAll((nodes) => nodes.map((node) => ({ value: node.value, text: node.textContent })))
  assert.ok(!reloadedOptions.some((option) => option.value === seed.alpha_reviewer_id), 'fresh options omit the now-disabled role')
  assert.equal(await roleSelect().inputValue(), seed.alpha_editor_id)

  // An ordinary active tenant member cannot read, assign, or revoke; the UI also remains read-only.
  await setToken(seed.member_token)
  await page.goto(`${seed.web}/tenants/${seed.tenant_a_id}`)
  await page.getByRole('heading', { name: 'F12d Tenant Alpha' }).waitFor()
  await memberRow().waitFor()
  assert.equal(await memberRow().getByText('需租户管理员读取').count(), 1)
  assert.equal(await page.locator('select[aria-label="f12d-member自定义角色"]').count(), 0)
  const memberResponses = await page.evaluate(async ({ tenantId, memberId, roleId, token }) => {
    const base = `/api/v1/tenants/${tenantId}/members/${memberId}/custom-role`
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const get = await fetch(base, { headers })
    const put = await fetch(base, { method: 'PUT', headers, body: JSON.stringify({ role_id: roleId }) })
    const del = await fetch(base, { method: 'DELETE', headers })
    const decode = async (response) => ({ status: response.status, body: response.status === 204 ? null : await response.json() })
    return Promise.all([decode(get), decode(put), decode(del)])
  }, { tenantId: seed.tenant_a_id, memberId: seed.member_id, roleId: seed.alpha_editor_id, token: seed.member_token })
  for (const response of memberResponses) {
    assert.equal(response.status, 403)
    assert.equal(response.body.code, 'FORBIDDEN')
  }

  // The same role assignment for Tenant B remains unchanged after Tenant A operations.
  await setToken(seed.actor_token)
  await gotoTenant(seed.tenant_b_id, 'F12d Tenant Beta')
  assert.equal(await roleSelect().inputValue(), seed.beta_editor_id)
  console.log('F12d tenant member custom-role frontend verification passed')
} finally {
  await browser.close()
}
