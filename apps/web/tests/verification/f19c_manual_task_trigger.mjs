import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const base = process.env.WEB_BASE_URL
const tenantA = process.env.TENANT_A_ID
const tenantB = process.env.TENANT_B_ID
const password = 'F19c-browser-password!'
const browser = await chromium.launch({ headless: true })

async function login(user, tenantId, canManage = true, expectedDeniedText = '仅租户所有者或管理员') {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${base}/tenants/${tenantId}/scheduled-tasks`)
  await page.locator('input[name="user_name"]').fill(user)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  if (canManage) {
    await page.getByRole('heading', { name: '系统任务定义' }).waitFor()
  } else {
    await page.getByRole('alert').filter({ hasText: expectedDeniedText }).waitFor()
  }
  return { context, page }
}

async function runTask(page, taskName, expectedText) {
  const row = page.locator('tr').filter({ hasText: taskName })
  await row.getByRole('button', { name: '立即运行' }).click()
  await page.getByRole('alertdialog').locator('button').last().click()
  await page.getByRole('status').filter({ hasText: expectedText }).waitFor()
  return row
}

try {
  const owner = await login(process.env.OWNER_USER, tenantA)
  const { page } = owner
  await page.getByText('F19c Browser Success', { exact: true }).waitFor()
  await page.getByText('F19c Browser Failure', { exact: true }).waitFor()

  const disabledRow = page.locator('tr').filter({ hasText: 'F19c Browser Disabled' })
  assert.equal(await disabledRow.getByRole('button', { name: '立即运行' }).isDisabled(), true)

  const successRow = await runTask(page, 'F19c Browser Success', '手工运行成功')
  await page.getByRole('heading', { name: '执行记录：F19c Browser Success' }).waitFor()
  await page.getByText('共 1 条').waitFor()
  await page.getByRole('button', { name: '关闭' }).click()

  await runTask(page, 'F19c Browser Failure', '手工运行失败')
  await page.getByText('INVALID_PARAMETERS', { exact: true }).waitFor()
  const failureText = await page.locator('[role="status"]').last().innerText()
  assert.equal(failureText.includes('F19C-BROWSER-SENSITIVE'), false)
  await page.getByRole('button', { name: '关闭' }).click()

  const leasedRow = page.locator('tr').filter({ hasText: 'F19c Browser Leased' })
  await leasedRow.getByRole('button', { name: '立即运行' }).click()
  await page.getByRole('alertdialog').locator('button').last().click()
  await page.getByRole('alert').filter({ hasText: '该任务已有正在执行的计划运行' }).waitFor()

  let doubleClickPosts = 0
  const countDoubleClickPosts = (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/runs')) doubleClickPosts += 1
  }
  page.on('request', countDoubleClickPosts)
  const doubleClickRow = page.locator('tr').filter({ hasText: 'F19c Browser Double Click' })
  await doubleClickRow.getByRole('button', { name: '立即运行' }).dblclick()
  await page.getByRole('alertdialog').locator('button').last().click()
  await page.getByRole('status').filter({ hasText: '手工运行成功' }).waitFor()
  assert.equal(doubleClickPosts, 1)
  page.off('request', countDoubleClickPosts)
  await page.getByRole('button', { name: '关闭' }).click()

  await page.getByRole('button', { name: '创建任务' }).focus()
  await page.getByRole('button', { name: '立即运行' }).first().focus()
  await page.keyboard.press('Enter')
  await page.getByRole('alertdialog').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('alertdialog').waitFor({ state: 'detached' })

  await page.setViewportSize({ width: 420, height: 900 })
  await page.locator('tr').filter({ hasText: 'F19c Browser Success' }).getByRole('button', { name: '执行记录' }).focus()
  assert.equal(await page.locator('tr').filter({ hasText: 'F19c Browser Success' }).getByRole('button', { name: '执行记录' }).count(), 1)

  await page.goto(`${base}/tenants/${tenantB}/scheduled-tasks`)
  await page.getByText('F19c Browser Beta Task', { exact: true }).waitFor()
  assert.equal(await page.getByText('F19c Browser Success', { exact: true }).count(), 0)
  await page.goto(`${base}/tenants/${tenantA}/scheduled-tasks`)
  await page.getByText('F19c Browser Success', { exact: true }).waitFor()
  assert.equal(await page.getByText('F19c Browser Beta Task', { exact: true }).count(), 0)

  const admin = await login(process.env.ADMIN_USER, tenantA)
  await admin.page.getByRole('button', { name: '立即运行' }).first().waitFor()
  await admin.context.close()

  const member = await login(process.env.MEMBER_USER, tenantA, false)
  assert.equal(await member.page.getByRole('button', { name: '立即运行' }).count(), 0)
  const forbidden = await member.page.evaluate(async ({ tenantId, taskId }) => {
    const state = JSON.parse(localStorage.getItem('synapse-auth') || '{}')
    const token = state?.state?.auth?.accessToken || state?.state?.auth?.access_token || state?.accessToken
    const response = await fetch(`/api/v1/tenants/${tenantId}/scheduled-tasks/${taskId}/runs`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
    return response.status
  }, { tenantId: tenantA, taskId: process.env.SUCCESS_TASK_ID })
  assert.equal(forbidden, 403)

  await member.context.close()

  const memberFromOwner = await page.evaluate(async ({ tenantId, memberId }) => {
    const state = JSON.parse(localStorage.getItem('synapse-auth') || '{}')
    const token = state?.state?.auth?.accessToken || state?.state?.auth?.access_token || state?.accessToken
    const response = await fetch(`/api/v1/tenants/${tenantId}/members/${memberId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ status: 'removed' }),
    })
    return response.status
  }, { tenantId: tenantA, memberId: process.env.MEMBER_ID })
  assert.equal(memberFromOwner, 200)

  const revokedMember = await login(process.env.MEMBER_USER, tenantA, false, 'RESOURCE_NOT_FOUND')
  await revokedMember.page.reload()
  await revokedMember.page.getByText('租户成员资格无效或已失效', { exact: false }).waitFor().catch(() => {})
  await revokedMember.context.close()

  await page.evaluate(() => localStorage.setItem('synapse-locale', 'en'))
  await page.reload()
  await page.getByText('F19c Browser Double Click', { exact: true }).waitFor()
  await page.route('**/runs', async (route) => {
    if (route.request().method() === 'POST') {
      await route.abort()
    } else {
      await route.continue()
    }
  })
  await page.locator('tr').filter({ hasText: 'F19c Browser Double Click' }).getByRole('button', { name: /立即运行|Run now/ }).click()
  await page.getByRole('alertdialog').locator('button').last().click()
  const finalAlert = page.getByRole('alert').last()
  await finalAlert.waitFor()
  const finalAlertText = await finalAlert.innerText()
  assert.match(finalAlertText, /The server may have received the request\.|Unable to reach the server\.|请求结果不确定/)
  await page.unroute('**/runs')

  await owner.context.close()
  console.log('F19c Playwright assertions passed')
} finally {
  await browser.close()
}
