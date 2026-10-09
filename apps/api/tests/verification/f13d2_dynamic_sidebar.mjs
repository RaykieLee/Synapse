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
  await context.addCookies([{ name: 'synapse_access_token', value: token, url: seed.web }])
}
const link = (label) => page.getByRole('link', { name: label, exact: true })
const chooseWorkspace = async (name) => {
  await page.getByRole('button', { name: '选择工作区' }).click()
  await page.getByPlaceholder('搜索空间或租户…').fill(name)
  await page.getByRole('option', { name: new RegExp(name) }).click()
  await page.waitForURL(new RegExp(`/w/${name === 'Alpha One' ? seed.wa : name === 'Alpha Two' ? seed.wa2 : seed.wb}`))
}
const openWorkspace = async (id) => {
  await page.goto(`${seed.web}/w/${id}`)
  await page.getByText('工作空间', { exact: true }).waitFor().catch(() => {})
  await page.getByRole('button', { name: '选择工作区' }).waitFor()
}
const assertStaticShell = async () => {
  await link('租户管理').waitFor()
  assert.equal(await link('Dashboard').count(), 0, 'template business Dashboard is not added to workspace shell')
  assert.equal(await link('Tasks').count(), 0)
  assert.equal(await link('Apps').count(), 0)
  assert.equal(await link('Chats').count(), 0)
}
const alphaOwner = async () => {
  await link('Alpha Granted Parent').waitFor()
  await link('Alpha Granted Parent / Alpha Custom Leaf').waitFor()
  assert.equal(await page.getByText('Alpha Hidden Parent', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Hidden Parent Child', { exact: true }).count(), 0)
}

try {
  await setToken(seed.actor_token)
  await openWorkspace(seed.wa)
  await alphaOwner()
  await assertStaticShell()
  // Same actor crosses workspaces and tenant boundary. During target load the old tree must disappear.
  let betaStarted
  const betaRequest = new Promise((resolve) => { betaStarted = resolve })
  let releaseBeta
  const betaGate = new Promise((resolve) => { releaseBeta = resolve })
  await page.route((url) => url.pathname.endsWith(`/tenants/${seed.tenant_b}/menus/visible-tree`), async (route) => {
    betaStarted()
    const response = await route.fetch()
    await betaGate
    await route.fulfill({ response })
  })
  await chooseWorkspace('Beta One')
  await betaRequest
  assert.equal(await page.getByText('Alpha Granted Parent', { exact: true }).count(), 0, 'old tenant menu clears while new request is pending')
  assert.equal(await page.getByText('Beta Admin Only', { exact: true }).count(), 0, 'new tenant tree is not shown until its response settles')
  await assertStaticShell()
  releaseBeta()
  await link('Beta Admin Only').waitFor()
  assert.equal(await page.getByText('Alpha Custom Leaf', { exact: true }).count(), 0)
  await page.unrouteAll()

  // A delayed old-tenant response may complete after the user has switched back to Beta.
  await chooseWorkspace('Alpha Two')
  let alphaStarted
  const alphaRequest = new Promise((resolve) => { alphaStarted = resolve })
  let releaseAlpha
  const alphaGate = new Promise((resolve) => { releaseAlpha = resolve })
  await page.route((url) => url.pathname.endsWith(`/tenants/${seed.tenant_a}/menus/visible-tree`), async (route) => {
    alphaStarted()
    const response = await route.fetch()
    await alphaGate
    await route.fulfill({ response })
  })
  // Navigate to another Alpha workspace so a fresh request uses a different workspace cache key.
  await chooseWorkspace('Alpha One')
  await alphaRequest
  await chooseWorkspace('Beta One')
  await link('Beta Admin Only').waitFor()
  releaseAlpha()
  await page.waitForTimeout(500)
  assert.equal(await page.getByText('Alpha Granted Parent', { exact: true }).count(), 0, 'late old-scope response never returns to sidebar')
  assert.equal(await link('Beta Admin Only').count(), 1)
  await page.unrouteAll()

  // Server failure during scope change must also fail closed with the fixed system links intact.
  await chooseWorkspace('Alpha One')
  await link('Alpha Granted Parent').waitFor()
  await page.route((url) => url.pathname.endsWith(`/tenants/${seed.tenant_b}/menus/visible-tree`), async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'temporary verification failure' }) })
  })
  await chooseWorkspace('Beta One')
  await page.waitForTimeout(500)
  assert.equal(await page.getByText('Alpha Granted Parent', { exact: true }).count(), 0, 'error state does not retain previous tenant menu')
  assert.equal(await page.getByText('Beta Admin Only', { exact: true }).count(), 0, 'error state has no stale successful menu')
  await assertStaticShell()
  await page.unrouteAll()

  // Ordinary member sees only role-granted nodes, with ancestor filtering; unassigned member sees an empty tree.
  await setToken(seed.member_token)
  await openWorkspace(seed.wa)
  await link('Alpha Granted Parent').waitFor()
  await link('Alpha Granted Parent / Alpha Custom Leaf').waitFor()
  assert.equal(await page.getByText('Alpha Hidden Parent', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Hidden Parent Child', { exact: true }).count(), 0)
  await assertStaticShell()

  await setToken(seed.no_role_token)
  await openWorkspace(seed.wa)
  await page.waitForTimeout(700)
  assert.equal(await page.getByText('Alpha Granted Parent', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Alpha Custom Leaf', { exact: true }).count(), 0)
  await assertStaticShell()

  // Revoke all role grants through the real admin API, then reload as the member to obtain the advanced context version.
  const revokeResponse = await fetch(`${seed.api}/tenants/${seed.tenant_a}/roles/${seed.role_id}/menus`, {
    method: 'PUT', headers: { Authorization: `Bearer ${seed.actor_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ menu_ids: [] }),
  })
  const revoke = { status: revokeResponse.status, body: await revokeResponse.json() }
  assert.equal(revoke.status, 200, `role grant revocation succeeds: ${JSON.stringify(revoke)}`)
  await setToken(seed.member_token)
  await openWorkspace(seed.wa)
  await page.waitForTimeout(500)
  assert.equal(await page.getByText('Alpha Granted Parent', { exact: true }).count(), 0, 'revoked menu is removed after refreshed membership_version')
  assert.equal(await page.getByText('Alpha Custom Leaf', { exact: true }).count(), 0)
  await assertStaticShell()
  console.log('F13d2 dynamic sidebar browser verification passed')
} finally {
  await browser.close()
}
