import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')
const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
await context.addCookies([{ name: 'synapse_access_token', value: seed.manager_token, url: seed.web }])
const page = await context.newPage()
page.setDefaultTimeout(15000)
const mutations = []
page.on('request', (request) => {
  if (['POST', 'PATCH', 'DELETE'].includes(request.method()) && request.url().includes('/departments')) {
    mutations.push({ method: request.method(), url: request.url(), body: request.postDataJSON() })
  }
})
page.on('pageerror', (error) => console.error('Browser page error:', error.message))
const row = (name) => page.locator('div.rounded-md.border.p-3').filter({ has: page.getByText(name, { exact: true }) })
const api = (tenantId, path = '') => `/api/v1/tenants/${tenantId}/departments${path}`
const managerFetch = async (url, method = 'GET', body) => page.evaluate(async ({ url, method, body, token }) => {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, data: response.status === 204 ? null : await response.json() }
}, { url, method, body, token: seed.manager_token })

try {
  // Same manager has different tenant roles; each tenant route must render only its own tree.
  await page.goto(`${seed.web}/tenants/${seed.tenant_a_id}/departments`)
  await page.getByRole('heading', { name: '租户部门' }).waitFor()
  await row('Alpha Root').waitFor()
  await row('Alpha Child').waitFor()
  assert.equal(await page.getByText('Beta Root', { exact: true }).count(), 0)
  await page.goto(`${seed.web}/tenants/${seed.tenant_b_id}/departments`)
  await page.getByRole('heading', { name: '租户部门' }).waitFor()
  await row('Beta Root').waitFor()
  await row('Beta Child').waitFor()
  assert.equal(await page.getByText('Alpha Root', { exact: true }).count(), 0)
  await page.goto(`${seed.web}/tenants/${seed.tenant_a_id}/departments`)
  await row('Alpha Root').waitFor()
  assert.equal(await page.getByText('Beta Root', { exact: true }).count(), 0, 'returning to tenant A restores only its tree')

  // Owner creates a branch and a leaf through the UI.
  await page.getByRole('button', { name: '创建部门' }).click()
  await page.getByLabel('部门名称').fill('Alpha New Team')
  await page.getByLabel('上级部门').selectOption(seed.alpha_root_id)
  await page.getByRole('button', { name: '创建部门' }).last().click()
  await row('Alpha New Team').waitFor()
  let tree = (await managerFetch(api(seed.tenant_a_id, '/tree?include_disabled=true'))).data.items
  const newTeam = tree[0].children.find((department) => department.dept_name === 'Alpha New Team')
  assert.ok(newTeam, 'create persisted beneath selected parent')

  await page.getByRole('button', { name: '创建部门' }).click()
  await page.getByLabel('部门名称').fill('Alpha New Leaf')
  await page.getByLabel('上级部门').selectOption(newTeam.department_id)
  await page.getByRole('button', { name: '创建部门' }).last().click()
  await row('Alpha New Leaf').waitFor()
  tree = (await managerFetch(api(seed.tenant_a_id, '/tree?include_disabled=true'))).data.items
  const leaf = tree[0].children.find((department) => department.department_id === newTeam.department_id).children[0]
  assert.equal(leaf.dept_name, 'Alpha New Leaf')

  // Move the team under another active parent and verify ancestor paths returned by API.
  await row('Alpha New Team').getByRole('button', { name: '编辑' }).click()
  await page.getByLabel('上级部门').selectOption(seed.alpha_sibling_id)
  const moveResponse = page.waitForResponse((response) => response.url().includes(`/departments/${newTeam.department_id}`) && response.request().method() === 'PATCH')
  await page.getByRole('button', { name: '保存部门' }).click()
  assert.equal((await moveResponse).status(), 200)
  const moved = await managerFetch(api(seed.tenant_a_id, `/${newTeam.department_id}`))
  assert.equal(moved.status, 200)
  assert.equal(moved.data.parent_id, seed.alpha_sibling_id)
  assert.equal(moved.data.ancestors, `0,${seed.alpha_sibling_id}`)
  const movedLeaf = await managerFetch(api(seed.tenant_a_id, `/${leaf.department_id}`))
  assert.equal(movedLeaf.data.ancestors, `0,${seed.alpha_sibling_id},${newTeam.department_id}`)

  // Sibling reorder is persisted by the real reorder endpoint.
  const reorderResponse = page.waitForResponse((response) => response.url().endsWith('/departments/reorder') && response.request().method() === 'POST')
  await row('Alpha Sibling').getByRole('button', { name: '上移' }).click()
  assert.equal((await reorderResponse).status(), 200)
  await expectOrder()
  async function expectOrder() {
    const result = await managerFetch(api(seed.tenant_a_id, '/tree?include_disabled=true'))
    assert.equal(result.data.items[0].department_id, seed.alpha_sibling_id)
    assert.ok(mutations.some((item) => item.method === 'POST' && item.url.endsWith('/departments/reorder')))
  }

  // Toggle status off and on, checking persisted state each time.
  const disableResponse = page.waitForResponse((response) => response.url().includes(`/departments/${seed.alpha_root_id}`) && response.request().method() === 'PATCH')
  await row('Alpha Root').getByRole('button', { name: '停用' }).click()
  assert.equal((await disableResponse).status(), 200)
  assert.equal((await managerFetch(api(seed.tenant_a_id, `/${seed.alpha_root_id}`))).data.status, '1')
  const enableResponse = page.waitForResponse((response) => response.url().includes(`/departments/${seed.alpha_root_id}`) && response.request().method() === 'PATCH')
  await row('Alpha Root').getByRole('button', { name: '启用' }).click()
  assert.equal((await enableResponse).status(), 200)
  assert.equal((await managerFetch(api(seed.tenant_a_id, `/${seed.alpha_root_id}`))).data.status, '0')

  // Leaf deletion succeeds; non-leaf deletion is explained in the UI.
  await row('Alpha New Leaf').getByRole('button', { name: '删除' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认删除' }).click()
  await row('Alpha New Leaf').waitFor({ state: 'detached' })
  assert.equal((await managerFetch(api(seed.tenant_a_id, `/${leaf.department_id}`))).status, 404)
  await row('Alpha Root').getByRole('button', { name: '删除' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认删除' }).click()
  await page.getByRole('alert').getByText('请先删除或移动此部门下的子部门。').waitFor()

  // Simulate a stale editor: a concurrent parent change makes the submitted move cyclic.
  await row('Alpha Root').getByRole('button', { name: '编辑' }).click()
  await page.getByLabel('上级部门').selectOption(seed.alpha_sibling_id)
  const cycleSetup = await managerFetch(api(seed.tenant_a_id, `/${seed.alpha_sibling_id}`), 'PATCH', { parent_id: seed.alpha_root_id })
  assert.equal(cycleSetup.status, 200)
  await page.getByRole('button', { name: '保存部门' }).click()
  await page.getByRole('alert').getByText('部门父级关系不能形成循环。').waitFor()
  await page.getByRole('button', { name: '取消' }).click()
  const cleanup = await managerFetch(api(seed.tenant_a_id, `/${seed.alpha_sibling_id}`), 'PATCH', { parent_id: null })
  assert.equal(cleanup.status, 200)

  // Tenant B admin can create and update within B; A resources never appear in B's tree.
  await page.goto(`${seed.web}/tenants/${seed.tenant_b_id}/departments`)
  await page.getByRole('heading', { name: '租户部门' }).waitFor()
  await page.getByRole('button', { name: '创建部门' }).click()
  await page.getByLabel('部门名称').fill('Beta Admin Department')
  await page.getByRole('button', { name: '创建部门' }).last().click()
  await row('Beta Admin Department').waitFor()
  assert.equal(await page.getByText('Alpha Root', { exact: true }).count(), 0)

  // Ordinary member is denied by page controls and direct API access.
  const memberContext = await browser.newContext()
  await memberContext.addCookies([{ name: 'synapse_access_token', value: seed.member_token, url: seed.web }])
  const memberPage = await memberContext.newPage()
  memberPage.setDefaultTimeout(15000)
  await memberPage.goto(`${seed.web}/tenants/${seed.tenant_a_id}`, { waitUntil: 'domcontentloaded' })
  await memberPage.getByRole('heading', { name: 'F14b Tenant Alpha' }).waitFor()
  assert.equal(await memberPage.getByRole('link', { name: '部门管理' }).count(), 0, 'ordinary member does not see department-management entry')
  await memberPage.goto(`${seed.web}/tenants/${seed.tenant_a_id}/departments`)
  await memberPage.getByRole('alert').getByText('仅租户所有者或管理员可以管理部门。').waitFor()
  assert.equal(await memberPage.getByRole('button', { name: '创建部门' }).count(), 0)
  assert.deepEqual(await memberPage.evaluate(async ({ tenantId, token }) => {
    const response = await fetch(`/api/v1/tenants/${tenantId}/departments/tree?include_disabled=true`, { headers: { Authorization: `Bearer ${token}` } })
    return response.status
  }, { tenantId: seed.tenant_a_id, token: seed.member_token }), 403)
  await memberContext.close()

  assert.ok(mutations.some((item) => item.method === 'PATCH'))
  assert.ok(mutations.some((item) => item.method === 'DELETE'))
  console.log('F14b tenant department frontend verification passed')
} finally {
  await browser.close()
}
