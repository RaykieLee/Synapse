import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const base = process.env.WEB_BASE_URL
const tenantA = process.env.TENANT_A_ID
const tenantB = process.env.TENANT_B_ID
const browser = await chromium.launch({ headless: true })

async function login(user, password, tenantId, canManage = true) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${base}/tenants/${tenantId}/scheduled-tasks`)
  await page.locator('input[name="user_name"]').fill(user)
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  if (canManage) await page.getByRole('heading', { name: '系统任务定义' }).waitFor()
  else await page.getByRole('alert').filter({ hasText: '仅租户所有者或管理员' }).waitFor()
  return { context, page }
}

try {
  const owner = await login('f18c-owner', 'F18c-test-password!', tenantA)
  const { page } = owner
  await page.getByText('Alpha task 20', { exact: true }).waitFor()
  assert.equal(await page.getByText('共 21 项').count(), 1)
  await page.getByLabel('按任务名称筛选').fill('Alpha task 00')
  await page.getByText('Alpha task 00', { exact: true }).waitFor()
  await page.getByText('Alpha task 01', { exact: true }).waitFor({ state: 'detached' })
  await page.getByLabel('按任务名称筛选').fill('')

  await page.getByLabel('按计划类型筛选').selectOption('cron')
  await page.getByText('Alpha task 00', { exact: true }).waitFor()
  await page.getByLabel('按计划类型筛选').selectOption('')
  await page.getByLabel('按启用状态筛选').selectOption('false')
  await page.getByLabel('按启用状态筛选').selectOption('')
  await page.getByRole('button', { name: '下一页' }).click()
  await page.getByText('第 2 页').waitFor()
  await page.getByText('Alpha task 00', { exact: true }).waitFor()
  await page.getByRole('button', { name: '上一页' }).click()

  await page.getByRole('button', { name: '创建任务' }).click()
  const editor = page.locator('form').filter({ has: page.getByRole('heading', { name: '创建任务' }) })
  await editor.getByLabel('任务名称').fill('F18c Browser Created')
  const targets = await editor.getByLabel('执行目标').locator('option').evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean))
  assert.deepEqual(new Set(targets), new Set([
    'tenant.expire_pending_invitations', 'tenant.reconcile_attachment_metadata', 'tenant.refresh_resource_summary',
  ]))
  await editor.getByLabel('执行目标').selectOption('tenant.refresh_resource_summary')
  await editor.getByLabel('IANA 时区', { exact: true }).fill('Asia/Shanghai')
  await editor.locator('input[placeholder="例如：0 2 * * *"]').fill('61 * * * *')
  await editor.getByRole('button', { name: '保存' }).click()
  await page.getByRole('alert').filter({ hasText: 'VALIDATION_ERROR' }).waitFor()
  await editor.locator('input[placeholder="例如：0 2 * * *"]').fill('0 2 * * *')
  await editor.getByRole('button', { name: '保存' }).click()
  await page.getByText('F18c Browser Created', { exact: true }).waitFor()

  let row = page.locator('tr').filter({ hasText: 'F18c Browser Created' })
  await row.getByRole('button', { name: '编辑' }).click()
  const edit = page.locator('form').filter({ has: page.getByRole('heading', { name: '编辑任务' }) })
  await edit.getByLabel('计划类型').selectOption('interval')
  await edit.getByLabel('间隔数值').fill('15')
  await edit.getByLabel('间隔单位').selectOption('seconds')
  await edit.getByRole('button', { name: '保存' }).click()
  row = page.locator('tr').filter({ hasText: 'F18c Browser Created' })
  await row.getByText('15 秒').waitFor()
  await row.getByRole('button', { name: '停用' }).click()
  await row.getByText('停用', { exact: true }).waitFor()
  await row.getByRole('button', { name: '启用' }).click()
  await row.getByText('启用', { exact: true }).waitFor()

  const invalid = await page.evaluate(async ({ tenantId }) => {
    const state = JSON.parse(localStorage.getItem('synapse-auth') || '{}')
    const token = state?.state?.auth?.accessToken || state?.state?.auth?.access_token || state?.accessToken
    const response = await fetch(`/api/v1/tenants/${tenantId}/scheduled-tasks`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ task_name: 'bad allowlist target', execution_target: 'python:os.system', parameters: {}, schedule_type: 'cron', cron_expression: '0 2 * * *', timezone: 'UTC' }),
    })
    return response.status
  }, { tenantId: tenantA })
  assert.equal(invalid, 422)

  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('button', { name: '删除' }).click()
  await row.waitFor({ state: 'detached' })

  await page.goto(`${base}/tenants/${tenantB}/scheduled-tasks`)
  await page.getByText('Beta Secret Task', { exact: true }).waitFor()
  assert.equal(await page.getByText('Alpha task 00', { exact: true }).count(), 0)
  await page.goto(`${base}/tenants/${tenantA}/scheduled-tasks`)
  await page.getByLabel('按任务名称筛选').fill('Alpha task 00')
  await page.getByText('Alpha task 00', { exact: true }).waitFor()
  assert.equal(await page.getByText('Beta Secret Task', { exact: true }).count(), 0)
  await owner.context.close()

  const admin = await login('f18c-admin', 'F18c-test-password!', tenantA)
  await admin.page.getByRole('button', { name: '创建任务' }).waitFor()
  await admin.context.close()

  const member = await login('f18c-member', 'F18c-test-password!', tenantA, false)
  assert.equal(await member.page.getByRole('button', { name: '创建任务' }).count(), 0)
  await member.page.getByRole('alert').filter({ hasText: '仅租户所有者或管理员' }).waitFor()
  const forbidden = await member.page.evaluate(async ({ tenantId }) => {
    const state = JSON.parse(localStorage.getItem('synapse-auth') || '{}')
    const token = state?.state?.auth?.accessToken || state?.state?.auth?.access_token || state?.accessToken
    const response = await fetch(`/api/v1/tenants/${tenantId}/scheduled-tasks`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
    return response.status
  }, { tenantId: tenantA })
  assert.equal(forbidden, 403)
  await member.context.close()
  console.log('F18c Playwright assertions passed')
} finally {
  await browser.close()
}
