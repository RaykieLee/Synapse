import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')

const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
await context.grantPermissions(['clipboard-read', 'clipboard-write'])
const page = await context.newPage()
page.setDefaultTimeout(12000)
const setToken = async (token) => {
  await context.clearCookies()
  if (token) await context.addCookies([{ name: 'synapse_access_token', value: token, url: seed.web }])
}
const signInThroughReturnLink = async (url, username) => {
  await setToken(null)
  await page.goto(url)
  await page.getByRole('heading', { name: '接受邀请' }).waitFor()
  await page.getByRole('link', { name: '返回登录页' }).click()
  await page.waitForURL((current) => current.pathname === '/sign-in')
  const redirect = new URL(page.url()).searchParams.get('redirect')
  assert.ok(redirect, 'sign-in URL preserves the invitation redirect')
  assert.equal(new URL(redirect, seed.web).searchParams.get('token'), new URL(url).searchParams.get('token'), 'redirect retains original invite token')
  await page.locator('input[autocomplete="username"]').fill(username)
  const passwordField = page.locator('form input[type="password"]')
  await passwordField.waitFor({ state: 'visible' })
  await passwordField.fill(seed.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((current) => current.pathname === '/invite/accept')
  assert.equal(new URL(page.url()).searchParams.get('token'), new URL(url).searchParams.get('token'))
}
const copyCreatedLink = async () => {
  const copy = page.getByRole('button', { name: '复制链接' })
  await copy.click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  assert.match(copied, /\/invite\/accept\?token=/)
  await page.getByRole('status').filter({ hasText: '已复制邀请链接' }).waitFor()
  return new URL(copied)
}
const makeInviteAsOwner = async (email, role = 'member') => {
  await page.getByPlaceholder('name@example.com').fill(email)
  await page.getByLabel('租户角色').selectOption(role)
  await page.getByRole('button', { name: '创建邀请' }).click()
  await page.getByText('邀请链接已创建').waitFor()
  return copyCreatedLink()
}

try {
  await setToken(seed.owner_token)
  await page.goto(`${seed.web}/tenants/${seed.tenant_id}`)
  await page.getByRole('heading', { name: 'Invite Test Tenant' }).waitFor()
  await page.getByRole('heading', { name: '邀请链接' }).waitFor()

  // Owner creates, copies, and revokes an invitation through the actual tenant UI.
  const revokedUrl = await makeInviteAsOwner('revoke@example.test', 'admin')
  const revokedRow = page.locator('tr').filter({ hasText: 'revoke@example.test' })
  await revokedRow.getByText('管理员').waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  await revokedRow.getByRole('button', { name: '撤销' }).click()
  await revokedRow.waitFor({ state: 'detached' })
  await signInThroughReturnLink(revokedUrl.toString(), 'f05c-target')
  await page.getByRole('button', { name: '接受租户邀请' }).click()
  await page.getByRole('alert').filter({ hasText: '已被撤销或已使用' }).waitFor()

  // Existing global-account email invite: login redirect retains token, acceptance adds only tenant membership.
  await setToken(seed.owner_token)
  await page.goto(`${seed.web}/tenants/${seed.tenant_id}`)
  const targetUrl = await makeInviteAsOwner('target@example.test', 'member')
  await signInThroughReturnLink(targetUrl.toString(), 'f05c-target')
  await page.getByRole('button', { name: '接受租户邀请' }).click()
  await page.getByRole('heading', { name: '已加入租户' }).waitFor()
  assert.equal(await page.getByText(`租户 ID：${seed.tenant_id}`).count(), 1)
  const accessibleWorkspaces = await page.evaluate(async () => {
    const token = document.cookie.split('; ').find((value) => value.startsWith('synapse_access_token='))?.split('=').slice(1).join('=')
    const response = await fetch('/api/v1/workspaces', { headers: { Authorization: `Bearer ${token}` } })
    return response.json()
  })
  assert.equal(accessibleWorkspaces.total, 0, 'accepted tenant membership does not automatically grant Workspace membership')

  // F05e: a recipient without a global account can create one from the invitation itself.
  await setToken(seed.owner_token)
  await page.goto(`${seed.web}/tenants/${seed.tenant_id}`)
  const registrationUrl = await makeInviteAsOwner('new-registration@example.test')
  await setToken(null)
  await page.goto(registrationUrl.toString())
  await page.getByRole('button', { name: '没有账号，创建账号' }).click()
  await page.getByLabel('用户名').fill('f05c-new-registration')
  await page.getByLabel('创建密码').fill('New-Registration-Password-2026!')
  await page.getByLabel('确认密码').fill('New-Registration-Password-2026!')
  await page.getByRole('button', { name: '创建账号并加入租户' }).click()
  await page.getByRole('heading', { name: '已加入租户' }).waitFor()
  assert.equal(await page.getByText(`租户 ID：${seed.tenant_id}`).count(), 1)
  assert.equal(new URL(page.url()).searchParams.get('token'), '', 'successful registration clears the invitation token from the URL')
  const registered = await page.evaluate(async () => {
    const token = document.cookie.split('; ').find((value) => value.startsWith('synapse_access_token='))?.split('=').slice(1).join('=')
    const headers = { Authorization: `Bearer ${token}` }
    const [meResponse, workspaceResponse] = await Promise.all([
      fetch('/api/v1/auth/me', { headers }),
      fetch('/api/v1/workspaces', { headers }),
    ])
    return { meStatus: meResponse.status, me: await meResponse.json(), workspaces: await workspaceResponse.json() }
  })
  assert.equal(registered.meStatus, 200)
  assert.equal(registered.me.user_name, 'f05c-new-registration')
  assert.equal(registered.me.email, 'new-registration@example.test')
  assert.equal(registered.me.platform_role, 'user', 'invite registration does not self-assign platform privileges')
  assert.equal(registered.workspaces.total, 0, 'new account gets no automatic Workspace membership')
  assert.equal(await page.locator('input[type="password"]').count(), 0, 'password is cleared after registration')
  await page.goto(registrationUrl.toString())
  await page.getByRole('button', { name: '接受租户邀请' }).click()
  await page.getByRole('alert').filter({ hasText: '已被撤销或已使用' }).waitFor()

  // Accepted invite cannot be accepted again.
  await page.goto(targetUrl.toString())
  await page.getByRole('button', { name: '接受租户邀请' }).click()
  await page.getByRole('alert').filter({ hasText: '已被撤销或已使用' }).waitFor()

  // Email mismatch and expiration are displayed as actionable invitation errors.
  await setToken(seed.owner_token)
  await page.goto(`${seed.web}/tenants/${seed.tenant_id}`)
  const emailUrl = await makeInviteAsOwner('not-existing@example.test')
  await setToken(seed.wrong_token)
  await page.goto(emailUrl.toString())
  await page.getByRole('button', { name: '接受租户邀请' }).click()
  await page.getByRole('alert').filter({ hasText: '当前账号与邀请指定的邮箱或账号不匹配' }).waitFor()
  await setToken(seed.owner_token)
  await page.goto(`${seed.web}/invite/accept?token=${encodeURIComponent(seed.expired_token)}`)
  await page.getByRole('button', { name: '接受租户邀请' }).waitFor()
  await page.getByRole('button', { name: '接受租户邀请' }).click()
  await page.getByRole('alert').filter({ hasText: '此邀请已过期' }).waitFor()

  // Pending link becomes unusable if its tenant is suspended.
  await setToken(seed.owner_token)
  await page.goto(`${seed.web}/tenants/${seed.tenant_id}`)
  const inactiveUrl = await makeInviteAsOwner('suspended@example.test')
  const suspended = await page.evaluate(async ({ tenantId, token }) => {
    const response = await fetch(`/api/v1/tenants/${tenantId}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'suspended' }) })
    return response.status
  }, { tenantId: seed.tenant_id, token: seed.platform_token })
  assert.equal(suspended, 200)
  await setToken(null)
  await page.goto(inactiveUrl.toString())
  await page.locator('input[autocomplete="username"]').fill('f05c-suspended')
  await page.locator('form input[type="password"]').fill(seed.password)
  await page.getByRole('button', { name: '登录并继续' }).click()
  await page.getByRole('button', { name: '接受租户邀请' }).click()
  await page.getByRole('alert').filter({ hasText: '该租户当前不可加入' }).waitFor()
  const restored = await page.evaluate(async ({ tenantId, token }) => {
    const response = await fetch(`/api/v1/tenants/${tenantId}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) })
    return response.status
  }, { tenantId: seed.tenant_id, token: seed.platform_token })
  assert.equal(restored, 200)

  // Tenant admin can create/copy/revoke member invitations only; ordinary member cannot administer invites.
  await setToken(seed.admin_token)
  await page.goto(`${seed.web}/tenants/${seed.tenant_id}`)
  await page.getByRole('heading', { name: '邀请链接' }).waitFor()
  const roleSelect = page.getByLabel('租户角色')
  assert.equal(await roleSelect.locator('option[value="admin"]').count(), 0, 'tenant admin cannot select the admin invite role')
  const adminInvite = await makeInviteAsOwner('admin-created@example.test')
  const adminRow = page.locator('tr').filter({ hasText: 'admin-created@example.test' })
  page.once('dialog', (dialog) => dialog.accept())
  await adminRow.getByRole('button', { name: '撤销' }).click()
  await adminRow.waitFor({ state: 'detached' })
  assert.ok(adminInvite.searchParams.get('token'))

  await setToken(seed.member_token)
  await page.goto(`${seed.web}/tenants/${seed.tenant_id}`)
  assert.equal(await page.getByRole('heading', { name: '邀请链接' }).count(), 0, 'tenant member has no invitation controls')
  const memberCreate = await page.evaluate(async ({ tenantId, token }) => {
    const response = await fetch(`/api/v1/tenants/${tenantId}/invitations`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'member-created@example.test', tenant_role: 'member' }) })
    return response.status
  }, { tenantId: seed.tenant_id, token: seed.member_token })
  assert.equal(memberCreate, 403, 'backend rejects member invitation creation')

  console.log('F05c/F05e tenant invite frontend verification passed')
} finally {
  await browser.close()
}
