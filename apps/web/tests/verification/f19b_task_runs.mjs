import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const base = process.env.WEB_BASE_URL
const tenantA = process.env.TENANT_A_ID
const tenantB = process.env.TENANT_B_ID
const browser = await chromium.launch({ headless: true })

async function login(user, password, tenantId, canManage = true) {
  const context = await browser.newContext({ timezoneId: 'UTC' })
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
  const owner = await login('f19b-owner', 'F19b-test-password!', tenantA)
  const { page } = owner
  const taskRow = page.locator('tr').filter({ hasText: 'Alpha primary task' })
  await taskRow.getByRole('button', { name: '执行记录' }).click()
  await page.getByRole('heading', { name: '执行记录：Alpha primary task' }).waitFor()
  await page.getByText('共 21 条').waitFor()
  await page.getByRole('button', { name: '下一页' }).last().click()
  await page.getByText('第 2 页').last().waitFor()
  await page.getByRole('button', { name: '上一页' }).last().click()

  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: '执行记录：Alpha primary task' }) })
  await panel.getByLabel('状态').selectOption('failed')
  await panel.getByRole('cell', { name: '失败' }).first().waitFor()
  await panel.getByRole('button', { name: '查看' }).first().click()
  await panel.getByRole('heading', { name: '运行详情' }).waitFor()
  await panel.getByText('SAFE_HANDLER_ERROR', { exact: true }).waitFor()
  const detailText = await panel.locator('[aria-live="polite"]').innerText()
  assert.equal(detailText.includes('PARAMETER-SECRET-F19B'), false)
  assert.equal(detailText.includes('CLAIM-TOKEN-F19B'), false)

  await panel.getByLabel('状态').selectOption('')
  await panel.locator('input[type="datetime-local"]').nth(0).fill('2026-10-02T08:05')
  await panel.locator('input[type="datetime-local"]').nth(1).fill('2026-10-02T08:10')
  await panel.getByText('共 6 条').waitFor()
  await panel.locator('input[type="datetime-local"]').nth(0).fill('')
  await panel.locator('input[type="datetime-local"]').nth(1).fill('')
  await panel.getByText('共 21 条').waitFor()

  await panel.getByLabel('状态').selectOption('succeeded')
  await panel.getByRole('button', { name: '查看' }).first().click()
  await panel.getByText('expired_count', { exact: false }).waitFor()
  const successDetail = await panel.locator('[aria-live="polite"]').innerText()
  assert.match(successDetail, /expired_count[\s\S]*3/)
  assert.equal(successDetail.includes('PARAMETER-SECRET-F19B'), false)
  assert.equal(successDetail.includes('CLAIM-TOKEN-F19B'), false)
  await page.getByRole('button', { name: '关闭' }).click()

  const admin = await login('f19b-admin', 'F19b-test-password!', tenantA)
  const adminTask = admin.page.locator('tr').filter({ hasText: 'Alpha primary task' })
  await adminTask.getByRole('button', { name: '执行记录' }).click()
  await admin.page.getByRole('heading', { name: '执行记录：Alpha primary task' }).waitFor()
  await admin.context.close()

  await page.goto(`${base}/tenants/${tenantB}/scheduled-tasks`)
  const betaTask = page.locator('tr').filter({ hasText: 'Beta primary task' })
  await betaTask.getByRole('button', { name: '执行记录' }).click()
  await page.getByRole('heading', { name: '执行记录：Beta primary task' }).waitFor()
  await page.getByText('共 1 条').waitFor()
  assert.equal(await page.getByText('Alpha primary task', { exact: true }).count(), 0)
  await page.goto(`${base}/tenants/${tenantA}/scheduled-tasks`)
  await page.locator('tr').filter({ hasText: 'Alpha primary task' }).getByRole('button', { name: '执行记录' }).click()
  await page.getByText('共 21 条').waitFor()
  assert.equal(await page.getByText('Beta primary task', { exact: true }).count(), 0)
  await owner.context.close()

  const member = await login('f19b-member', 'F19b-test-password!', tenantA, false)
  assert.equal(await member.page.getByRole('button', { name: '执行记录' }).count(), 0)
  assert.equal(await member.page.getByRole('button', { name: '创建任务' }).count(), 0)
  const forbidden = await member.page.evaluate(async ({ tenantId, taskId }) => {
    const state = JSON.parse(localStorage.getItem('synapse-auth') || '{}')
    const token = state?.state?.auth?.accessToken || state?.state?.auth?.access_token || state?.accessToken
    const response = await fetch(`/api/v1/tenants/${tenantId}/scheduled-tasks/${taskId}/runs`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
    return response.status
  }, { tenantId: tenantA, taskId: process.env.TASK_A_ID })
  assert.equal(forbidden, 403)
  await member.context.close()
  console.log('F19b Playwright assertions passed')
} finally {
  await browser.close()
}
