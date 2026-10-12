import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')
const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
await context.addCookies([{ name: 'synapse_access_token', value: seed.owner_token, url: seed.web }])
const page = await context.newPage()
page.setDefaultTimeout(15000)
const writes = []
page.on('request', (request) => {
  if (['POST', 'PATCH', 'DELETE'].includes(request.method()) && request.url().includes('/configs')) writes.push({ method: request.method(), url: request.url(), body: request.postDataJSON() })
})
page.on('pageerror', (error) => console.error('Browser page error:', error.message))
const row = (name) => page.locator('tbody tr').filter({ hasText: name })
const configsUrl = (tenantId) => `/api/v1/tenants/${tenantId}/configs`
const spaNavigate = async (path) => {
  const target = `${seed.web}${path}`
  await page.evaluate((nextPath) => {
    window.history.pushState({}, '', nextPath)
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  }, path)
  await page.waitForURL(target)
}
const fetchAs = async (url, method = 'GET', body) => page.evaluate(async ({ url, method, body, token }) => {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, data: response.status === 204 ? null : await response.json() }
}, { url, method, body, token: seed.owner_token })

try {
  await page.goto(`${seed.web}/tenants/${seed.tenant_a_id}/configs`)
  await page.getByRole('heading', { name: '租户参数配置' }).waitFor()
  await row('Alpha Secret').waitFor()
  assert.equal(await page.getByText(seed.sensitive_a_value, { exact: true }).count(), 0, 'sensitive value never appears in the list')
  assert.equal(await page.getByText('Alpha Config 00', { exact: true }).count(), 0, 'initial list page is capped at 20')
  assert.equal(await page.getByText('共 22 条').count(), 1)
  await page.getByRole('button', { name: '下一页' }).click()
  await row('Alpha Config 00').waitFor()
  await page.getByRole('button', { name: '上一页' }).click()

  // Filters issue tenant-scoped list queries.
  await page.getByLabel('按键名筛选').fill('alpha.key05')
  await row('Alpha Config 05').waitFor()
  assert.equal(await page.locator('tbody tr').count(), 1)
  await page.getByLabel('按键名筛选').fill('')
  await page.getByLabel('按分组筛选').fill('secrets')
  await row('Alpha Secret').waitFor()
  assert.equal(await page.locator('tbody tr').count(), 1)
  await page.getByLabel('按分组筛选').fill('')
  await row('Alpha Secret').waitFor()

  // Owner CRUDs a regular configuration through the page.
  await page.getByRole('button', { name: '创建参数' }).click()
  let form = page.locator('form')
  await form.getByLabel('配置名称').fill('Alpha Created')
  await form.getByLabel('配置键名').fill('alpha.created')
  await form.getByLabel('分组').fill('alpha-crud')
  await form.getByLabel('配置值').fill('alpha-created-value')
  const createA = page.waitForResponse((response) => response.url().endsWith(`/tenants/${seed.tenant_a_id}/configs`) && response.request().method() === 'POST')
  await form.getByRole('button', { name: '保存配置' }).click()
  assert.equal((await createA).status(), 201)
  await row('Alpha Created').waitFor()
  const createdA = (await fetchAs(`${configsUrl(seed.tenant_a_id)}?config_key=alpha.created`)).data.items[0]
  await row('Alpha Created').getByRole('button', { name: '编辑' }).click()
  form = page.locator('form')
  await form.getByLabel('配置名称').fill('Alpha Created Updated')
  await form.getByLabel('配置值').fill('alpha-updated-value')
  const patchA = page.waitForResponse((response) => response.url().endsWith(`/configs/${createdA.config_id}`) && response.request().method() === 'PATCH')
  await form.getByRole('button', { name: '保存配置' }).click()
  assert.equal((await patchA).status(), 200)
  assert.equal((await fetchAs(`${configsUrl(seed.tenant_a_id)}/${createdA.config_id}`)).data.config_name, 'Alpha Created Updated')
  const disableA = page.waitForResponse((response) => response.url().endsWith(`/configs/${createdA.config_id}`) && response.request().method() === 'PATCH')
  await row('Alpha Created Updated').getByRole('button', { name: '停用' }).click()
  assert.equal((await disableA).status(), 200)
  assert.equal((await fetchAs(`${configsUrl(seed.tenant_a_id)}/${createdA.config_id}`)).data.status, '1')
  await page.getByLabel('按状态筛选').selectOption('1')
  await row('Alpha Created Updated').waitFor()
  assert.equal(await page.locator('tbody tr').count(), 1)
  await page.getByLabel('按状态筛选').selectOption('')
  await row('Alpha Created Updated').waitFor()
  await page.getByLabel('按敏感级别筛选').selectOption('true')
  await row('Alpha Secret').waitFor()
  assert.equal(await page.locator('tbody tr').count(), 1)
  await page.getByLabel('按敏感级别筛选').selectOption('')
  await row('Alpha Created Updated').waitFor()
  page.once('dialog', (nativeDialog) => nativeDialog.accept())
  const deleteA = page.waitForResponse((response) => response.url().endsWith(`/configs/${createdA.config_id}`) && response.request().method() === 'DELETE')
  await row('Alpha Created Updated').getByRole('button', { name: '删除' }).click()
  assert.equal((await deleteA).status(), 204)
  await row('Alpha Created Updated').waitFor({ state: 'detached' })
  await row('Alpha Secret').waitFor()

  // The owner reveals a secret only by explicit action; closing clears it from rendered state.
  const sensitiveDetailResponse = page.waitForResponse((response) => response.url().endsWith(`/configs/${seed.sensitive_a_id}`) && response.request().method() === 'GET')
  await row('Alpha Secret').getByRole('button', { name: '查看敏感值' }).click()
  const sensitiveDetail = await (await sensitiveDetailResponse).json()
  assert.equal(sensitiveDetail.config_value, seed.sensitive_a_value)
  const dialog = page.locator('[role="dialog"]')
  await dialog.waitFor()
  await dialog.getByText(seed.sensitive_a_value, { exact: true }).waitFor()
  await dialog.locator('button').click()
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.getByText(seed.sensitive_a_value, { exact: true }).count(), 0, 'closing removes secret from page state')

  // A late detail response after switching tenants must not reopen or leak the A secret.
  let signalIntercept
  const intercepted = new Promise((resolve) => { signalIntercept = resolve })
  let releaseResponse
  const responseGate = new Promise((resolve) => { releaseResponse = resolve })
  const lateUrl = `${seed.web}/api/v1/tenants/${seed.tenant_a_id}/configs/${seed.sensitive_a_id}`
  await page.route(lateUrl, async (route) => {
    const response = await route.fetch()
    signalIntercept()
    await responseGate
    await route.fulfill({ response })
  })
  await row('Alpha Secret').getByRole('button', { name: '查看敏感值' }).click()
  await Promise.race([intercepted, new Promise((_, reject) => setTimeout(() => reject(new Error('sensitive detail request was not intercepted')), 10000))])
  await spaNavigate(`/tenants/${seed.tenant_b_id}/configs`)
  await page.getByRole('heading', { name: '租户参数配置' }).waitFor()
  await row('Beta Config').waitFor()
  assert.equal(await page.getByText('Alpha Secret', { exact: true }).count(), 0)
  assert.equal(await page.getByText(seed.sensitive_a_value, { exact: true }).count(), 0)
  releaseResponse()
  await page.waitForTimeout(300)
  assert.equal(await page.getByRole('dialog').count(), 0, 'late A response must not render a dialog in tenant B')
  assert.equal(await page.getByText(seed.sensitive_a_value, { exact: true }).count(), 0)
  await page.unroute(lateUrl)

  // The same actor is an admin in B. Tenant B data is separate; perform admin CRUD there.
  assert.equal(await page.getByText(seed.beta_value, { exact: true }).count(), 0, 'B secret remains redacted in its list')
  await page.getByRole('button', { name: '创建参数' }).click()
  form = page.locator('form')
  await form.getByLabel('配置名称').fill('Beta Admin Created')
  await form.getByLabel('配置键名').fill('beta.admin.created')
  await form.getByLabel('分组').fill('beta-group')
  await form.getByLabel('配置值').fill('beta-admin-value')
  const createB = page.waitForResponse((response) => response.url().endsWith(`/tenants/${seed.tenant_b_id}/configs`) && response.request().method() === 'POST')
  await form.getByRole('button', { name: '保存配置' }).click()
  assert.equal((await createB).status(), 201)
  await row('Beta Admin Created').waitFor()
  const createdB = (await fetchAs(`${configsUrl(seed.tenant_b_id)}?config_key=beta.admin.created`)).data.items[0]
  await row('Beta Admin Created').getByRole('button', { name: '编辑' }).click()
  await page.locator('form').getByLabel('配置值').fill('beta-admin-updated')
  const patchB = page.waitForResponse((response) => response.url().endsWith(`/configs/${createdB.config_id}`) && response.request().method() === 'PATCH')
  await page.locator('form').getByRole('button', { name: '保存配置' }).click()
  assert.equal((await patchB).status(), 200)
  assert.equal((await fetchAs(`${configsUrl(seed.tenant_b_id)}/${createdB.config_id}`)).data.config_value, 'beta-admin-updated')
  const disableB = page.waitForResponse((response) => response.url().endsWith(`/configs/${createdB.config_id}`) && response.request().method() === 'PATCH')
  await row('Beta Admin Created').getByRole('button', { name: '停用' }).click()
  assert.equal((await disableB).status(), 200)
  assert.equal((await fetchAs(`${configsUrl(seed.tenant_b_id)}/${createdB.config_id}`)).data.status, '1')
  page.once('dialog', (nativeDialog) => nativeDialog.accept())
  const deleteB = page.waitForResponse((response) => response.url().endsWith(`/configs/${createdB.config_id}`) && response.request().method() === 'DELETE')
  await row('Beta Admin Created').getByRole('button', { name: '删除' }).click()
  assert.equal((await deleteB).status(), 204)
  await row('Beta Admin Created').waitFor({ state: 'detached' })

  // A tenant A unsaved draft is cleared on route change and does not follow the actor into B.
  await spaNavigate(`/tenants/${seed.tenant_a_id}/configs`)
  await row('Alpha Secret').waitFor()
  await page.getByRole('button', { name: '创建参数' }).click()
  await page.locator('form').getByLabel('配置名称').fill('Alpha Unsaved Draft')
  await page.locator('form').getByLabel('配置键名').fill('alpha.unsaved.draft')
  await page.locator('form').getByLabel('配置值').fill('A-DRAFT-MUST-NOT-CROSS')
  await spaNavigate(`/tenants/${seed.tenant_b_id}/configs`)
  await row('Beta Config').waitFor()
  assert.equal(await page.getByRole('heading', { name: '创建参数配置' }).count(), 0)
  assert.equal(await page.getByText('A-DRAFT-MUST-NOT-CROSS', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Alpha Unsaved Draft', { exact: true }).count(), 0)
  await spaNavigate(`/tenants/${seed.tenant_a_id}/configs`)
  await row('Alpha Secret').waitFor()
  assert.equal(await page.getByRole('heading', { name: '创建参数配置' }).count(), 0, 'draft does not return after switching back')
  assert.equal(await page.getByText(seed.beta_value, { exact: true }).count(), 0)

  // Ordinary member sees no entry point and cannot access the management page/API directly.
  const memberContext = await browser.newContext()
  await memberContext.addCookies([{ name: 'synapse_access_token', value: seed.member_token, url: seed.web }])
  const memberPage = await memberContext.newPage()
  memberPage.setDefaultTimeout(15000)
  await memberPage.goto(`${seed.web}/tenants/${seed.tenant_a_id}`, { waitUntil: 'domcontentloaded' })
  await memberPage.getByRole('heading', { name: 'F16b Tenant Alpha' }).waitFor()
  assert.equal(await memberPage.getByRole('link', { name: '参数配置' }).count(), 0)
  await memberPage.goto(`${seed.web}/tenants/${seed.tenant_a_id}/configs`)
  await memberPage.getByRole('alert').getByText('仅租户所有者或管理员可以管理参数配置。').waitFor()
  assert.equal(await memberPage.getByRole('button', { name: '创建参数' }).count(), 0)
  assert.deepEqual(await memberPage.evaluate(async ({ tenantId, configId, token }) => {
    const base = `/api/v1/tenants/${tenantId}/configs`
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const get = await fetch(base, { headers })
    const post = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ config_name: 'No', config_key: 'member.no', config_value: 'no' }) })
    const detail = await fetch(`${base}/${configId}`, { headers })
    return [get.status, post.status, detail.status]
  }, { tenantId: seed.tenant_a_id, configId: seed.sensitive_a_id, token: seed.member_token }), [403, 403, 403])
  await memberContext.close()

  assert.ok(writes.some((write) => write.method === 'POST'))
  assert.ok(writes.some((write) => write.method === 'PATCH'))
  assert.ok(writes.some((write) => write.method === 'DELETE'))
  console.log('F16b tenant config frontend verification passed')
} finally {
  await browser.close()
}
