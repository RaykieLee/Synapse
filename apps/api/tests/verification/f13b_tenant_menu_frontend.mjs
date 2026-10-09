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
const menuNode = (name) => page.locator('div.flex.flex-wrap.items-center.gap-2.rounded-md.border.p-3').filter({ hasText: name })
const rootsFromApi = () => page.evaluate(async () => {
  const token = document.cookie.split('; ').find((value) => value.startsWith('synapse_access_token='))?.split('=').slice(1).join('=')
  const tenantId = new URL(location.href).pathname.split('/')[2]
  const response = await fetch(`/api/v1/tenants/${tenantId}/menus/tree?include_disabled=true`, { headers: { Authorization: `Bearer ${token}` } })
  return { status: response.status, items: (await response.json()).items }
})
const openMenu = async (tenantId, tenantName) => {
  await page.goto(`${seed.web}/tenants/${tenantId}/menus`)
  await page.getByRole('heading', { name: '租户菜单' }).waitFor()
  await page.getByText(tenantName, { exact: false }).first().waitFor()
}
const backToTenantList = async () => {
  await page.getByRole('link', { name: /返回 F13d Tenant|返回 F13b Tenant|返回 Tenant/ }).click().catch(async () => {
    await page.getByRole('link', { name: /返回/ }).first().click()
  })
  await page.getByRole('heading', { name: 'F13b Tenant Alpha' }).waitFor().catch(async () => {
    await page.getByRole('link', { name: /返回租户列表/ }).click()
  })
}
const toTenantDetailFromMenus = async () => {
  await page.getByRole('link', { name: /返回 F13b Tenant/ }).click()
  await page.getByRole('heading', { name: /F13b Tenant/ }).waitFor()
}
const toTenantList = async () => {
  await page.getByRole('link', { name: /返回租户列表/ }).click()
  await page.getByRole('heading', { name: '租户管理' }).waitFor()
}
const openTenantFromList = async (name) => {
  await page.locator('tbody tr').filter({ hasText: name }).getByRole('link', { name: '查看详情' }).click()
  await page.getByRole('heading', { name }).waitFor()
}

try {
  await setToken(seed.actor_token)
  await openMenu(seed.tenant_a_id, 'F13b Tenant Alpha')
  await page.getByRole('button', { name: '创建菜单' }).waitFor()
  await menuNode('Alpha Root One').waitFor()
  await menuNode('Alpha Root Two').waitFor()
  await menuNode('Alpha Leaf').waitFor()
  assert.equal(await page.getByText('Beta Private Root', { exact: true }).count(), 0)
  assert.equal(await menuNode('Alpha Root One').count(), 1)

  // Edit a seeded child and toggle it off/on in the actual menu editor/tree UI.
  await menuNode('Alpha Leaf').getByRole('button', { name: '编辑' }).click()
  await page.getByRole('heading', { name: '编辑菜单' }).waitFor()
  await page.getByLabel('名称').fill('Alpha Leaf Updated')
  await page.getByLabel('路由地址').fill('/alpha-leaf-updated')
  await page.getByRole('button', { name: '保存菜单' }).click()
  await menuNode('Alpha Leaf Updated').waitFor()
  let leafNode = menuNode('Alpha Leaf Updated')
  await leafNode.getByRole('button', { name: '停用' }).click()
  await leafNode.getByText(/停用/).waitFor()
  await leafNode.getByRole('button', { name: '启用' }).click()
  await leafNode.getByText(/启用/).waitFor()

  // Parent deletion with an active child is rejected by the server and shown to the owner.
  page.once('dialog', (dialog) => dialog.accept())
  await menuNode('Alpha Root One').getByRole('button', { name: '删除' }).click()
  await page.getByRole('alert').filter({ hasText: '请先删除或移动此菜单下的子菜单。' }).waitFor()
  assert.equal(await menuNode('Alpha Root One').count(), 1)

  // Create a third root through the editor, then reorder root siblings via Up.
  await page.getByRole('button', { name: '创建菜单' }).click()
  await page.getByRole('heading', { name: '创建菜单' }).waitFor()
  await page.getByLabel('名称').fill('Alpha Added Root')
  await page.getByLabel('排序').fill('50')
  await page.getByLabel('菜单类型').selectOption('M')
  await page.getByLabel('路由地址').fill('/alpha-added')
  await page.getByRole('button', { name: '保存菜单' }).click()
  await menuNode('Alpha Added Root').waitFor()
  const beforeOrder = (await rootsFromApi()).items.map((item) => item.menu_name)
  assert.deepEqual(beforeOrder, ['Alpha Root One', 'Alpha Root Two', 'Alpha Added Root'])
  await menuNode('Alpha Added Root').getByRole('button', { name: '上移' }).click()
  await page.waitForFunction(async () => {
    const token = document.cookie.split('; ').find((value) => value.startsWith('synapse_access_token='))?.split('=').slice(1).join('=')
    const tenantId = new URL(location.href).pathname.split('/')[2]
    const response = await fetch(`/api/v1/tenants/${tenantId}/menus/tree?include_disabled=true`, { headers: { Authorization: `Bearer ${token}` } })
    const roots = (await response.json()).items.map((item) => item.menu_name)
    return roots.indexOf('Alpha Added Root') < roots.indexOf('Alpha Root Two')
  })
  const afterOrder = (await rootsFromApi()).items.map((item) => item.menu_name)
  assert.deepEqual(afterOrder, ['Alpha Root One', 'Alpha Added Root', 'Alpha Root Two'])

  // Delete the leaf, then the now-leaf parent; each action is a soft delete.
  page.once('dialog', (dialog) => dialog.accept())
  await menuNode('Alpha Leaf Updated').getByRole('button', { name: '删除' }).click()
  await menuNode('Alpha Leaf Updated').waitFor({ state: 'detached' })
  page.once('dialog', (dialog) => dialog.accept())
  await menuNode('Alpha Root One').getByRole('button', { name: '删除' }).click()
  await menuNode('Alpha Root One').waitFor({ state: 'detached' })

  const alphaFinal = (await rootsFromApi()).items
  assert.deepEqual(alphaFinal.map((item) => item.menu_name), ['Alpha Added Root', 'Alpha Root Two'])
  assert.equal(alphaFinal.some((item) => item.menu_name.includes('Beta')), false)

  // Keep the same authenticated SPA session and query client while switching tenants.
  await toTenantDetailFromMenus()
  await toTenantList()
  await openTenantFromList('F13b Tenant Beta')
  await page.getByRole('link', { name: '菜单管理' }).click()
  await page.getByRole('heading', { name: '租户菜单' }).waitFor()
  await menuNode('Beta Private Root').waitFor()
  assert.equal(await page.getByText('Alpha Added Root', { exact: true }).count(), 0, 'cached Alpha tree does not leak into Beta')
  assert.equal(await page.getByText('Alpha Root Two', { exact: true }).count(), 0)

  // Tenant admin (same manager account, Tenant B role) can create through the same UI.
  await page.getByRole('button', { name: '创建菜单' }).click()
  await page.getByLabel('名称').fill('Beta Admin Menu')
  await page.getByLabel('排序').fill('20')
  await page.getByRole('button', { name: '保存菜单' }).click()
  await menuNode('Beta Admin Menu').waitFor()
  const betaFinal = (await rootsFromApi()).items
  assert.deepEqual(betaFinal.map((item) => item.menu_name), ['Beta Private Root', 'Beta Admin Menu'])
  assert.equal(betaFinal.some((item) => item.menu_name.startsWith('Alpha')), false)

  // Switch back in the same SPA: Alpha retains its own post-edit tree.
  await toTenantDetailFromMenus()
  await toTenantList()
  await openTenantFromList('F13b Tenant Alpha')
  await page.getByRole('link', { name: '菜单管理' }).click()
  await page.getByRole('heading', { name: '租户菜单' }).waitFor()
  await menuNode('Alpha Added Root').waitFor()
  assert.equal(await page.getByText('Beta Private Root', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Beta Admin Menu', { exact: true }).count(), 0)

  // Ordinary member sees an explanatory read-only state; API GET and POST are forbidden.
  await setToken(seed.member_token)
  const memberIdentity = await fetch(`${seed.api}/auth/me`, { headers: { Authorization: `Bearer ${seed.member_token}` } }).then(async (response) => ({ status: response.status, body: await response.json() }))
  assert.equal(memberIdentity.status, 200, `ordinary member token is valid: ${JSON.stringify(memberIdentity)}`)
  await page.goto(`${seed.web}/tenants/${seed.tenant_a_id}/menus`)
  await page.getByText('仅租户所有者或管理员可以管理租户菜单。').waitFor().catch(async () => {
    throw new Error(`ordinary member menu page did not show the expected denial; URL=${page.url()} BODY=${(await page.locator('body').innerText()).slice(0, 1400)}`)
  })
  assert.equal(await page.getByRole('button', { name: '创建菜单' }).count(), 0)
  const memberResults = await page.evaluate(async ({ tenantId, token }) => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const base = `/api/v1/tenants/${tenantId}/menus`
    const read = await fetch(`${base}/tree`, { headers })
    const create = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ menu_name: 'Unauthorized member menu' }) })
    const readBody = await read.json()
    const createBody = await create.json()
    return [{ status: read.status, code: readBody.code }, { status: create.status, code: createBody.code }]
  }, { tenantId: seed.tenant_a_id, token: seed.member_token })
  for (const result of memberResults) {
    assert.equal(result.status, 403)
    assert.equal(result.code, 'FORBIDDEN')
  }

  console.log('F13b tenant menu frontend verification passed')
} finally {
  await browser.close()
}
