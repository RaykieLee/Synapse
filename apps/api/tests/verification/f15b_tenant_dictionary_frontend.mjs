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
  if (['POST', 'PATCH', 'DELETE'].includes(request.method()) && request.url().includes('/dict/')) writes.push({ method: request.method(), url: request.url(), body: request.postDataJSON() })
})
page.on('pageerror', (error) => console.error('Browser page error:', error.message))
const typeRow = (name) => page.locator('tbody tr').filter({ hasText: name })
const typeRows = () => page.locator('main > section').first().locator('tbody tr')
const entryRow = (label) => page.locator('tbody tr').filter({ hasText: label })
const entryRows = () => page.locator('main > section').nth(1).locator('tbody tr')
const typeUrl = (tenantId) => `/api/v1/tenants/${tenantId}/dict/types`
const entryUrl = (tenantId, typeId) => `${typeUrl(tenantId)}/${typeId}/data`
const fetchAs = async (url, method = 'GET', body, token = seed.owner_token) => page.evaluate(async ({ url, method, body, token }) => {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, data: response.status === 204 ? null : await response.json() }
}, { url, method, body, token })

try {
  await page.goto(`${seed.web}/tenants/${seed.tenant_a_id}/dictionaries`)
  await page.getByRole('heading', { name: '租户字典' }).waitFor()
  await typeRow('Alpha Colors').waitFor()
  assert.equal(await page.getByText('Beta Colors', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Alpha Type 20', { exact: true }).count(), 0, 'page size limits the initial type page')
  await page.getByRole('button', { name: '下一页' }).first().click()
  await typeRow('Alpha Type 20').waitFor()
  assert.equal(await page.getByText('Beta Colors', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '上一页' }).first().click()

  // Search by type identifier and status filter both narrow the real API results.
  await page.getByLabel('类型搜索字段').selectOption('dict_type')
  await page.getByLabel('搜索字典类型').fill('alpha.type05')
  await typeRow('Alpha Type 05').waitFor()
  assert.equal(await typeRows().count(), 1)
  await page.getByLabel('搜索字典类型').fill('')
  await page.getByLabel('类型搜索字段').selectOption('dict_name')
  await typeRow('Alpha Colors').waitFor()

  // Create and edit a type using the UI, then verify API persistence.
  await page.getByRole('button', { name: '创建字典类型' }).click()
  await page.getByLabel('类型名称').fill('Alpha Created')
  await page.getByLabel('类型标识').fill('alpha.created')
  await page.getByLabel('排序').fill('300')
  const createTypeResponse = page.waitForResponse((response) => response.url().endsWith('/dict/types') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '保存类型' }).click()
  assert.equal((await createTypeResponse).status(), 201)
  let createdType = (await fetchAs(typeUrl(seed.tenant_a_id) + '?dict_type=alpha.created')).data.items[0]
  assert.ok(createdType)
  await page.getByLabel('类型搜索字段').selectOption('dict_type')
  await page.getByLabel('搜索字典类型').fill('alpha.created')
  await typeRow('Alpha Created').waitFor()
  await typeRow('Alpha Created').getByRole('button', { name: '编辑' }).click()
  await page.getByLabel('类型名称').fill('Alpha Created Updated')
  const patchTypeResponse = page.waitForResponse((response) => response.url().endsWith(`/dict/types/${createdType.dict_type_id}`) && response.request().method() === 'PATCH')
  await page.getByRole('button', { name: '保存类型' }).click()
  assert.equal((await patchTypeResponse).status(), 200)
  assert.equal((await fetchAs(`${typeUrl(seed.tenant_a_id)}/${createdType.dict_type_id}`)).data.dict_name, 'Alpha Created Updated')
  await page.getByLabel('搜索字典类型').fill('')
  await page.getByLabel('类型搜索字段').selectOption('dict_name')

  // Type state switch and sorting are server-backed.
  const disableTypeResponse = page.waitForResponse((response) => response.url().includes(`/dict/types/${seed.type_a_id}`) && response.request().method() === 'PATCH')
  await typeRow('Alpha Colors').getByRole('button', { name: '停用' }).click()
  assert.equal((await disableTypeResponse).status(), 200)
  assert.equal((await fetchAs(`${typeUrl(seed.tenant_a_id)}/${seed.type_a_id}`)).data.status, '1')
  const enableTypeResponse = page.waitForResponse((response) => response.url().includes(`/dict/types/${seed.type_a_id}`) && response.request().method() === 'PATCH')
  await typeRow('Alpha Colors').getByRole('button', { name: '启用' }).click()
  assert.equal((await enableTypeResponse).status(), 200)
  const typeReorderResponse = page.waitForResponse((response) => response.url().endsWith('/dict/types/reorder') && response.request().method() === 'POST')
  await typeRow('Alpha Type 01').getByRole('button', { name: '上移' }).click()
  assert.equal((await typeReorderResponse).status(), 200)
  let types = (await fetchAs(typeUrl(seed.tenant_a_id))).data.items
  assert.equal(types[0].dict_type_id, seed.type_a_next_id)

  // Owner manages paged entries under Alpha type; filters and actions remain type scoped.
  await typeRow('Alpha Colors').getByRole('button', { name: '管理条目' }).click()
  await page.getByRole('heading', { name: '字典条目：Alpha Colors' }).waitFor()
  await entryRow('Alpha Red').waitFor()
  assert.equal(await page.getByText('Beta Red', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Alpha Seed 20', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '下一页' }).last().click()
  await entryRow('Alpha Seed 20').waitFor()
  await page.getByRole('button', { name: '上一页' }).last().click()
  await page.getByLabel('搜索字典条目').fill('Alpha Red')
  await entryRow('Alpha Red').waitFor()
  assert.equal(await entryRows().count(), 1)
  await page.getByLabel('搜索字典条目').fill('')

  // Create and edit an entry; verify row content and API values.
  await page.getByRole('button', { name: '创建条目' }).click()
  await page.getByLabel('标签').fill('Alpha New Entry')
  await page.getByLabel('键值').fill('alpha-new')
  await page.getByLabel('排序').last().fill('300')
  const createEntryResponse = page.waitForResponse((response) => response.url().endsWith(`/dict/types/${seed.type_a_id}/data`) && response.request().method() === 'POST')
  await page.getByRole('button', { name: '保存条目' }).click()
  assert.equal((await createEntryResponse).status(), 201)
  await page.getByLabel('搜索字典条目').fill('Alpha New Entry')
  await entryRow('Alpha New Entry').waitFor()
  const createdEntry = (await fetchAs(entryUrl(seed.tenant_a_id, seed.type_a_id) + '?dict_label=Alpha%20New%20Entry')).data.items[0]
  await entryRow('Alpha New Entry').getByRole('button', { name: '编辑' }).click()
  await page.getByLabel('标签').fill('Alpha New Entry Updated')
  const patchEntryResponse = page.waitForResponse((response) => response.url().endsWith(`/dict/types/${seed.type_a_id}/data/${createdEntry.dict_data_id}`) && response.request().method() === 'PATCH')
  await page.getByRole('button', { name: '保存条目' }).click()
  assert.equal((await patchEntryResponse).status(), 200)
  assert.equal((await fetchAs(`${entryUrl(seed.tenant_a_id, seed.type_a_id)}/${createdEntry.dict_data_id}`)).data.dict_label, 'Alpha New Entry Updated')
  await page.getByLabel('搜索字典条目').fill('Alpha New Entry Updated')
  await entryRow('Alpha New Entry Updated').waitFor()
  await page.getByLabel('搜索字典条目').fill('')

  const disableEntryResponse = page.waitForResponse((response) => response.url().includes(`/data/${seed.entry_a_id}`) && response.request().method() === 'PATCH')
  await entryRow('Alpha Red').getByRole('button', { name: '停用' }).click()
  assert.equal((await disableEntryResponse).status(), 200)
  assert.equal((await fetchAs(`${entryUrl(seed.tenant_a_id, seed.type_a_id)}/${seed.entry_a_id}`)).data.status, '1')
  const enableEntryResponse = page.waitForResponse((response) => response.url().includes(`/data/${seed.entry_a_id}`) && response.request().method() === 'PATCH')
  await entryRow('Alpha Red').getByRole('button', { name: '启用' }).click()
  assert.equal((await enableEntryResponse).status(), 200)
  const entryReorderResponse = page.waitForResponse((response) => response.url().endsWith(`/dict/types/${seed.type_a_id}/data/reorder`) && response.request().method() === 'POST')
  await entryRow('Alpha Seed 01').getByRole('button', { name: '上移' }).click()
  assert.equal((await entryReorderResponse).status(), 200)
  const entries = (await fetchAs(entryUrl(seed.tenant_a_id, seed.type_a_id))).data.items
  assert.equal(entries[0].dict_data_id, seed.entry_a_next_id)

  // Deleting a type with values shows a useful conflict; delete entry, then empty type.
  page.once('dialog', (dialog) => dialog.accept())
  await typeRow('Alpha Colors').getByRole('button', { name: '删除' }).click()
  await page.getByRole('alert').getByText('请先删除该字典类型下的所有条目。').waitFor()
  assert.equal((await fetchAs(`${typeUrl(seed.tenant_a_id)}/${seed.type_a_id}`, 'DELETE')).status, 409)
  await page.getByLabel('搜索字典条目').fill('Alpha New Entry Updated')
  page.once('dialog', (dialog) => dialog.accept())
  await entryRow('Alpha New Entry Updated').getByRole('button', { name: '删除' }).click()
  await entryRow('Alpha New Entry Updated').waitFor({ state: 'detached' })
  assert.equal((await fetchAs(`${entryUrl(seed.tenant_a_id, seed.type_a_id)}/${createdEntry.dict_data_id}`)).status, 404)
  await page.getByLabel('类型搜索字段').selectOption('dict_type')
  await page.getByLabel('搜索字典类型').fill('alpha.empty')
  await typeRow('Alpha Empty').waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  await typeRow('Alpha Empty').getByRole('button', { name: '删除' }).click()
  await typeRow('Alpha Empty').waitFor({ state: 'detached' })

  // Same admin account enters Tenant B; same type key and entry label are isolated.
  await context.clearCookies()
  await context.addCookies([{ name: 'synapse_access_token', value: seed.admin_token, url: seed.web }])
  await page.goto(`${seed.web}/tenants/${seed.tenant_b_id}/dictionaries`)
  await page.getByRole('heading', { name: '租户字典' }).waitFor()
  await typeRow('Beta Colors').waitFor()
  assert.equal(await page.getByText('Alpha Colors', { exact: true }).count(), 0)
  await typeRow('Beta Colors').getByRole('button', { name: '管理条目' }).click()
  await page.getByRole('heading', { name: '字典条目：Beta Colors' }).waitFor()
  await entryRow('Beta Red').waitFor()
  assert.equal(await page.getByText('Alpha Red', { exact: true }).count(), 0)
  await page.goto(`${seed.web}/tenants/${seed.tenant_a_id}/dictionaries`)
  await typeRow('Alpha Colors').waitFor()
  assert.equal(await page.getByText('Beta Colors', { exact: true }).count(), 0, 'returning to Tenant A does not reuse Tenant B data')

  // Ordinary member sees no management entry and direct page/API access is denied.
  const memberContext = await browser.newContext()
  await memberContext.addCookies([{ name: 'synapse_access_token', value: seed.member_token, url: seed.web }])
  const memberPage = await memberContext.newPage()
  memberPage.setDefaultTimeout(15000)
  await memberPage.goto(`${seed.web}/tenants/${seed.tenant_a_id}`, { waitUntil: 'domcontentloaded' })
  await memberPage.getByRole('heading', { name: 'F15b Tenant Alpha' }).waitFor()
  assert.equal(await memberPage.getByRole('link', { name: '字典管理' }).count(), 0)
  await memberPage.goto(`${seed.web}/tenants/${seed.tenant_a_id}/dictionaries`)
  await memberPage.getByRole('alert').getByText('仅租户所有者或管理员可以管理字典。').waitFor()
  assert.equal(await memberPage.getByRole('button', { name: '创建字典类型' }).count(), 0)
  assert.equal((await memberPage.evaluate(async ({ tenantId, token }) => fetch(`/api/v1/tenants/${tenantId}/dict/types`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.status), { tenantId: seed.tenant_a_id, token: seed.member_token })), 403)
  await memberContext.close()

  assert.ok(writes.some((write) => write.method === 'POST' && write.url.endsWith('/dict/types/reorder')))
  assert.ok(writes.some((write) => write.method === 'POST' && write.url.endsWith(`/dict/types/${seed.type_a_id}/data/reorder`)))
  console.log('F15b tenant dictionary frontend verification passed')
} finally {
  await browser.close()
}
