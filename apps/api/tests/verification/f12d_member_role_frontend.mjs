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
const customRoleButton = () => memberRow().locator('td').nth(2).getByRole('button').first()
const customRoleDialog = () => page.getByRole('dialog', { name: '编辑自定义角色' })
const customRoleSelect = () => customRoleDialog().getByLabel('自定义角色', { exact: true })
const currentCustomRole = () => customRoleButton().innerText()
const waitRole = async (roleName) => {
  await memberRow().locator('td').nth(2).getByRole('button', { name: roleName, exact: true }).waitFor()
}
const openCustomRoleEditor = async () => {
  await customRoleButton().click()
  await customRoleDialog().waitFor()
}
const selectRole = async (roleId, roleName) => {
  await openCustomRoleEditor()
  await customRoleSelect().selectOption(roleId)
  await customRoleDialog().getByRole('button', { name: '保存角色' }).click()
  await customRoleDialog().waitFor({ state: 'hidden' })
  await waitRole(roleName)
}
const confirmRevoke = async () => {
  await memberRow().getByRole('button', { name: '撤销' }).click()
  const dialog = page.getByRole('alertdialog', { name: '撤销自定义角色' })
  await dialog.getByRole('button', { name: '确认撤销' }).click()
  await dialog.waitFor({ state: 'hidden' })
}
const gotoTenant = async (tenantId, heading) => {
  await page.goto(`${seed.web}/tenants/${tenantId}`)
  await page.getByRole('heading', { name: heading }).waitFor()
  await customRoleButton().waitFor()
}
const tenantRowsLinkTo = (tenantName) => page.locator('tbody tr').filter({ hasText: tenantName }).getByRole('link', { name: tenantName, exact: true })
const backToTenantList = async () => {
  await page.getByRole('link', { name: '租户管理' }).first().click()
  await page.getByRole('heading', { name: '租户管理' }).waitFor()
}

try {
  await setToken(seed.actor_token)
  await gotoTenant(seed.tenant_a_id, 'F12d Tenant Alpha')
  assert.equal(await currentCustomRole(), 'Alpha Reviewer', 'owner reads the existing Tenant A assignment')

  // Tenant-member role edits are also modal-driven, independently of the custom role.
  const tenantRoleCell = memberRow().locator('td').nth(1)
  await tenantRoleCell.getByRole('button', { name: '成员', exact: true }).click()
  const tenantRoleDialog = page.getByRole('dialog', { name: '编辑成员角色' })
  await tenantRoleDialog.waitFor()
  assert.equal(await tenantRoleDialog.getByLabel('租户角色').inputValue(), 'member')
  await tenantRoleDialog.getByRole('button', { name: '取消' }).click()
  await tenantRoleDialog.waitFor({ state: 'hidden' })

  await openCustomRoleEditor()
  const alphaOptions = await customRoleSelect().locator('option').allTextContents()
  assert.ok(alphaOptions.includes('Alpha Reviewer'))
  assert.ok(alphaOptions.includes('Alpha Editor'))
  assert.ok(!alphaOptions.includes('Alpha Disabled'), 'disabled tenant role is absent from assignment choices')
  assert.ok(!alphaOptions.includes('Beta Auditor') && !alphaOptions.includes('Beta Editor'), 'Tenant B roles do not leak into Tenant A choices')
  await customRoleDialog().getByRole('button', { name: '取消' }).click()

  // Tenant A owner replaces and revokes the assigned role through the UI.
  await selectRole(seed.alpha_editor_id, 'Alpha Editor')
  await selectRole(seed.alpha_reviewer_id, 'Alpha Reviewer')
  await confirmRevoke()
  await waitRole('未分配')
  assert.equal(await memberRow().getByRole('button', { name: '撤销' }).count(), 0)
  await selectRole(seed.alpha_editor_id, 'Alpha Editor')
  assert.equal((await tenantRoleCell.innerText()).trim(), '成员', 'custom role assignment leaves the built-in tenant role unchanged')

  // Same actor and same target user, but a different tenant-scoped cached assignment.
  await backToTenantList()
  await tenantRowsLinkTo('F12d Tenant Beta').click()
  await page.getByRole('heading', { name: 'F12d Tenant Beta' }).waitFor()
  await customRoleButton().waitFor()
  assert.equal(await currentCustomRole(), 'Beta Auditor', 'admin sees the distinct Tenant B assignment after SPA navigation')
  await openCustomRoleEditor()
  const betaOptions = await customRoleSelect().locator('option').allTextContents()
  assert.ok(betaOptions.includes('Beta Auditor') && betaOptions.includes('Beta Editor'))
  assert.ok(!betaOptions.includes('Alpha Reviewer') && !betaOptions.includes('Alpha Editor'), 'Tenant A roles do not leak into Tenant B choices')
  await customRoleDialog().getByRole('button', { name: '取消' }).click()

  // Built-in tenant admin on Tenant B can assign, replace and revoke as well.
  await selectRole(seed.beta_editor_id, 'Beta Editor')
  await selectRole(seed.beta_auditor_id, 'Beta Auditor')
  await confirmRevoke()
  await waitRole('未分配')
  await selectRole(seed.beta_editor_id, 'Beta Editor')

  await backToTenantList()
  await tenantRowsLinkTo('F12d Tenant Alpha').click()
  await page.getByRole('heading', { name: 'F12d Tenant Alpha' }).waitFor()
  await customRoleButton().waitFor()
  assert.equal(await currentCustomRole(), 'Alpha Editor', 'returning to Tenant A restores its own assignment rather than Tenant B state')

  // Race boundary: active options were loaded, then an administrator disables one in the real API.
  // The stale option remains only in the cached dialog; the server must reject and explain it.
  const disabledUpdate = await page.evaluate(async ({ tenantId, roleId }) => {
    const token = document.cookie.split('; ').find((value) => value.startsWith('synapse_access_token='))?.split('=').slice(1).join('=')
    const response = await fetch(`/api/v1/tenants/${tenantId}/roles/${roleId}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })
    return response.status
  }, { tenantId: seed.tenant_a_id, roleId: seed.alpha_reviewer_id })
  assert.equal(disabledUpdate, 200, 'owner disables the role through the tenant-role API')
  await openCustomRoleEditor()
  await customRoleSelect().selectOption(seed.alpha_reviewer_id)
  await customRoleDialog().getByRole('button', { name: '保存角色' }).click()
  await customRoleDialog().getByRole('alert').filter({ hasText: 'RESOURCE_NOT_FOUND' }).waitFor()
  assert.equal(await customRoleSelect().inputValue(), seed.alpha_reviewer_id, 'failed stale assignment stays visible for correction')
  await customRoleDialog().getByRole('button', { name: '取消' }).click()
  await page.reload()
  await page.getByRole('heading', { name: 'F12d Tenant Alpha' }).waitFor()
  await customRoleButton().waitFor()
  await openCustomRoleEditor()
  const reloadedOptions = await customRoleSelect().locator('option').evaluateAll((nodes) => nodes.map((node) => ({ value: node.value, text: node.textContent })))
  assert.ok(!reloadedOptions.some((option) => option.value === seed.alpha_reviewer_id), 'fresh options omit the now-disabled role')
  assert.equal(await customRoleSelect().inputValue(), seed.alpha_editor_id)
  await customRoleDialog().getByRole('button', { name: '取消' }).click()

  // A tenant member may read their own custom role, but cannot assign or revoke it.
  await setToken(seed.member_token)
  await page.goto(`${seed.web}/tenants/${seed.tenant_a_id}`)
  await page.getByRole('heading', { name: 'F12d Tenant Alpha' }).waitFor()
  await memberRow().waitFor()
  await memberRow().locator('td').nth(2).getByText('Alpha Editor').waitFor()
  assert.equal(await memberRow().locator('td').nth(2).getByRole('button').count(), 0)
  const memberResponses = await page.evaluate(async ({ tenantId, memberId, roleId, token }) => {
    const base = `/api/v1/tenants/${tenantId}/members/${memberId}/custom-role`
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const get = await fetch(base, { headers })
    const put = await fetch(base, { method: 'PUT', headers, body: JSON.stringify({ role_id: roleId }) })
    const del = await fetch(base, { method: 'DELETE', headers })
    const decode = async (response) => ({ status: response.status, body: response.status === 204 ? null : await response.json() })
    return Promise.all([decode(get), decode(put), decode(del)])
  }, { tenantId: seed.tenant_a_id, memberId: seed.member_id, roleId: seed.alpha_editor_id, token: seed.member_token })
  assert.equal(memberResponses[0].status, 200, 'a member can read their own custom role')
  assert.equal(memberResponses[0].body.role.role_id, seed.alpha_editor_id)
  for (const response of memberResponses.slice(1)) {
    assert.equal(response.status, 403)
    assert.equal(response.body.code, 'FORBIDDEN')
  }

  // The same role assignment for Tenant B remains unchanged after Tenant A operations.
  await setToken(seed.actor_token)
  await gotoTenant(seed.tenant_b_id, 'F12d Tenant Beta')
  assert.equal(await currentCustomRole(), 'Beta Editor')
  console.log('F12d tenant member custom-role frontend verification passed')
} finally {
  await browser.close()
}
