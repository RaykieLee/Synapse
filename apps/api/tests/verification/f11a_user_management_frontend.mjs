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
const rowFor = (username) => page.locator('tbody tr').filter({ hasText: username })
const apiStatus = (token) => page.evaluate(async (accessToken) => {
  const response = await fetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } })
  return response.status
}, token)
const login = (username, password) => page.evaluate(async ({ user_name, password: pass }) => {
  const response = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_name, password: pass }) })
  return { status: response.status, body: await response.json() }
}, { user_name: username, password })
const searchFor = async (value) => {
  const input = page.getByLabel('搜索用户')
  await input.fill(value)
  await page.waitForURL((url) => {
    const current = url.searchParams.get('search') ?? ''
    return url.pathname === '/users' && current === value
  })
  if (value) {
    await page.getByText('共 1 个账号').waitFor()
    await rowFor(value).waitFor()
  }
  else await page.getByText(/共 \d+ 个账号/).waitFor()
}

try {
  // Platform admin sees a live, paginated API listing rather than seeded demo rows.
  await setToken(seed.admin_token)
  await page.goto(`${seed.web}/users?page=1&pageSize=10`)
  await page.getByRole('heading', { name: '全局用户' }).waitFor()
  await page.getByRole('link', { name: 'Users' }).waitFor()
  await page.getByText('共 25 个账号').waitFor()
  assert.equal(await page.locator('tbody tr').count(), 10, 'page size limits the visible live rows')
  await page.getByText('第 1 / 3 页').waitFor()
  const visibleNames = await page.locator('tbody tr').locator('td:first-child span:first-child').allTextContents()
  assert.ok(visibleNames.every((name) => name.startsWith('f11a-')), 'the visible rows exactly belong to the disposable API seed; no Faker/demo rows appear')
  await page.getByRole('button', { name: '下一页' }).click()
  await page.getByText('第 2 / 3 页').waitFor()
  await page.getByRole('button', { name: '上一页' }).click()
  await page.getByText('第 1 / 3 页').waitFor()

  // Server-side search across the seeded user's username and email.
  await searchFor('f11a-victim')
  assert.equal(await page.locator('tbody tr').count(), 1)
  assert.equal(await rowFor('f11a-victim').count(), 1)
  await searchFor('f11a-victim@example.com')
  assert.equal(await page.locator('tbody tr').count(), 1, 'email search returns the same API account')

  // Create from the real form, then verify API-origin data and duplicate-conflict feedback.
  await searchFor('')
  await page.getByRole('button', { name: '创建用户' }).click()
  await page.getByRole('heading', { name: '创建全局用户' }).waitFor()
  await page.getByLabel('用户名').fill('f11a-created')
  await page.getByLabel('初始密码').fill('F11a-Created-Password-2026!')
  await page.getByLabel('昵称').fill('Created From Browser')
  await page.getByLabel('邮箱').fill('f11a-created@example.com')
  const createResponsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/users') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '创建账号' }).click()
  const createResponse = await createResponsePromise
  const createBody = await createResponse.json()
  const createOutcome = await Promise.race([
    page.getByRole('status').filter({ hasText: '用户账号已创建' }).waitFor().then(() => 'success'),
    page.getByRole('alert').waitFor().then(async () => `error: ${await page.getByRole('alert').allTextContents()}`),
  ])
  assert.equal(createOutcome, 'success', `create user outcome: ${createOutcome}; API ${createResponse.status()} ${JSON.stringify(createBody)}`)
  await searchFor('f11a-created')
  assert.equal(await rowFor('f11a-created').count(), 1)
  const createdIdentityCell = await rowFor('f11a-created').locator('td:first-child').innerText()
  assert.match(createdIdentityCell, /user/, 'new account is not created as a platform admin')
  assert.doesNotMatch(createdIdentityCell, /platform_admin/)

  await page.getByRole('button', { name: '创建用户' }).click()
  await page.getByLabel('用户名').fill('f11a-another-name')
  await page.getByLabel('初始密码').fill('F11a-Another-Password-2026!')
  await page.getByLabel('邮箱').fill('f11a-created@example.com')
  await page.getByRole('button', { name: '创建账号' }).click()
  await page.getByRole('alert').filter({ hasText: '用户名或邮箱已被使用' }).waitFor()
  await page.getByRole('button', { name: '取消' }).click()

  // Edit a profile and confirm the new name/email are returned by API-backed search.
  await searchFor('f11a-victim')
  let victimRow = rowFor('f11a-victim')
  await victimRow.getByRole('button', { name: '编辑' }).click()
  await page.getByRole('heading', { name: '编辑用户资料' }).waitFor()
  await page.getByLabel('昵称').fill('Victim Updated In UI')
  await page.getByLabel('邮箱').fill('f11a-victim-edited@example.com')
  await page.getByRole('button', { name: '保存资料' }).click()
  await page.getByRole('status').filter({ hasText: '用户资料已更新' }).waitFor()
  await searchFor('Victim Updated In UI')
  victimRow = rowFor('f11a-victim')
  await victimRow.getByText('Victim Updated In UI').waitFor()
  assert.equal(await victimRow.getByText('f11a-victim-edited@example.com').count(), 1)

  // Status changes revoke the prior token; reactivation does not revive that token.
  const victimLogin = await login('f11a-victim', seed.password)
  assert.equal(victimLogin.status, 200)
  const beforeDisable = victimLogin.body.access_token
  await victimRow.getByRole('button', { name: '停用' }).click()
  await page.getByRole('status').filter({ hasText: '账号已停用' }).waitFor()
  await victimRow.getByText('已停用').waitFor()
  assert.equal(await apiStatus(beforeDisable), 401)
  await victimRow.getByRole('button', { name: '启用' }).click()
  await page.getByRole('status').filter({ hasText: '账号已启用' }).waitFor()
  const afterReactivate = await login('f11a-victim', seed.password)
  assert.equal(afterReactivate.status, 200)
  assert.equal(await apiStatus(beforeDisable), 401, 'reactivation does not restore a token revoked at disable time')

  // Reset through the UI and verify both token revocation and the new password.
  await victimRow.getByRole('button', { name: '重置密码' }).click()
  await page.getByRole('heading', { name: '重置密码' }).waitFor()
  await page.getByLabel('新密码').fill('F11a-Reset-Password-2026!')
  await page.getByRole('button', { name: '重置密码' }).last().click()
  await page.getByRole('status').filter({ hasText: '密码已重置' }).waitFor()
  assert.equal(await apiStatus(afterReactivate.body.access_token), 401)
  const resetLogin = await login('f11a-victim', 'F11a-Reset-Password-2026!')
  assert.equal(resetLogin.status, 200)

  // Soft delete removes the account from list/search and revokes its current token.
  page.once('dialog', (dialog) => dialog.accept())
  await victimRow.getByRole('button', { name: '删除' }).click()
  await victimRow.waitFor({ state: 'detached' })
  assert.equal(await apiStatus(resetLogin.body.access_token), 401)
  await searchFor('f11a-victim')
  await page.getByText('没有匹配的用户。').waitFor()

  // Ordinary user has no Users navigation entry and cannot enter the route directly.
  await setToken(seed.ordinary_token)
  await page.goto(`${seed.web}/`)
  await page.getByRole('heading').first().waitFor()
  assert.equal(await page.getByRole('link', { name: 'Users' }).count(), 0, 'ordinary-user sidebar hides platform user management')
  await page.goto(`${seed.web}/users`)
  await page.waitForURL((url) => url.pathname === '/403')
  assert.equal(await page.getByRole('heading', { name: '全局用户' }).count(), 0, 'direct route is rejected for ordinary account')

  console.log('F11a global user management frontend verification passed')
} finally {
  await browser.close()
}
