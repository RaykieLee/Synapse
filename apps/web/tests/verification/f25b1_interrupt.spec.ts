import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { Request, Route } from 'playwright'

const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')
const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
let page = await context.newPage()
page.setDefaultTimeout(20000)
const reportVerificationLog = (message: string) => {
  // Verification output is intentionally visible in the command-line run.
  // eslint-disable-next-line no-console
  console.log(message)
}
const reportPageError = (message: string) => {
  // Browser errors are part of the verification diagnostics.
  // eslint-disable-next-line no-console
  console.error(message)
}
page.on('pageerror', (error: Error) => reportPageError(`Browser page error: ${error.message}`))

const setToken = async (token: string) => {
  await context.clearCookies()
  await context.addCookies([{ name: 'synapse_access_token', value: token, url: seed.web }])
}

const control = async (path: string, body: Record<string, unknown> = {}) => {
  const response = await fetch(`${seed.proxy}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  assert.equal(response.status, 200, text)
  return JSON.parse(text)
}

const sessionPath = `${seed.web}/w/${seed.workspace}/sessions`

type SessionEntry = {
  session: {
    id: string
  }
  [key: string]: unknown
}

type SessionListResponse = {
  sessions: SessionEntry[]
  [key: string]: unknown
}

const selectSession = async () => {
  await page.goto(sessionPath)
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.getByLabel('智能体').selectOption(seed.agent)
  const row = page.getByRole('button', { name: /F25b1 Interrupt Session/ })
  await row.waitFor()
  await row.click()
  await page.getByRole('heading', { name: 'F25b1 Interrupt Session', exact: true }).waitFor()
}

const installStatusProjection = async (status: 'awaiting_permission' | 'awaiting_external_result') => {
  await page.route('**/api/v1/ai/sessions/?*', async (route: Route) => {
    try {
      const response = await route.fetch()
      const body = await response.json() as SessionListResponse
      const projected = {
        ...body,
        sessions: body.sessions.map((entry: SessionEntry) => entry.session.id === seed.session
          ? { ...entry, status, is_running: false }
          : entry),
      }
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body: JSON.stringify(projected),
      })
    } catch {
      // A late poll may race browser.close(); it is not a product failure.
      await route.abort().catch(() => undefined)
    }
  })
}

try {
  await setToken(seed.actor_token)
  await control('/__f25b1/lock')
  await selectSession()

  await page.getByText('运行中', { exact: true }).first().waitFor()
  const interrupt = page.getByRole('button', { name: '中断生成', exact: true })
  await interrupt.waitFor()

  // The proxy deliberately holds the real interrupt response so the browser
  // exposes the pending state and disables the duplicate click.
  const interruptRequest = page.waitForRequest((request: Request) =>
    request.method() === 'POST' && request.url().includes(`/sessions/${seed.session}/interrupt`),
  )
  await interrupt.click()
  await interruptRequest
  await page.getByRole('button', { name: '正在请求中断…', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '正在请求中断…', exact: true }).count(), 1)
  assert.equal(await page.getByRole('button', { name: '中断生成', exact: true }).count(), 0)
  await control('/__f25b1/unlock')
  await page.getByRole('button', { name: '等待停止…', exact: true }).waitFor()
  await page.getByRole('button', { name: '发送', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '中断生成', exact: true }).count(), 0)

  // The real idle API does not render an interrupt control, and therefore a
  // repeated user click cannot issue another request from this state.
  assert.equal(await page.getByRole('button', { name: '中断生成', exact: true }).count(), 0)

  // These two projections exercise the frontend's supported parked-state
  // branches without claiming a real model/tool HITL run.
  for (const status of ['awaiting_permission', 'awaiting_external_result'] as const) {
    await page.close()
    page = await context.newPage()
    page.setDefaultTimeout(20000)
    await installStatusProjection(status)
    await selectSession()
    await page.getByRole('heading', { name: 'F25b1 Interrupt Session', exact: true }).waitFor()
    await control('/__f25b1/lock')
    await page.getByRole('button', { name: '中断生成', exact: true }).waitFor()
    await page.getByRole('button', { name: '中断生成', exact: true }).click()
    await page.getByRole('button', { name: '正在请求中断…', exact: true }).waitFor()
    await control('/__f25b1/unlock')
    await page.getByRole('button', { name: '等待停止…', exact: true }).waitFor()
    await page.getByRole('button', { name: '发送', exact: true }).waitFor()
  }

  reportVerificationLog('F25b1 interrupt browser verification passed (parked states projected)')
} finally {
  await browser.close()
}
