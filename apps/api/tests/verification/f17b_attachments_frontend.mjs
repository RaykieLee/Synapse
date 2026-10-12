import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')
const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ acceptDownloads: true })
await context.addInitScript(() => {
  window.localStorage.setItem('synapse-locale', 'zh-CN')
})
await context.addCookies([{ name: 'synapse_access_token', value: seed.actor_a_token, url: seed.web }])
const page = await context.newPage()
page.setDefaultTimeout(15000)
const pageErrors = []
const writes = []
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('request', (request) => {
  if (['POST', 'DELETE'].includes(request.method()) && request.url().includes('/attachments')) {
    writes.push({ method: request.method(), url: request.url() })
  }
})

const workspacePath = (id) => `/w/${id}/attachments`
const attachmentUrl = (id, suffix = '') => `${seed.api}/workspaces/${id}/attachments${suffix}`
const fileInput = page.locator('#workspace-attachment-file')
const alertText = () => page.getByRole('alert').last().innerText()
const fileRow = (filename, target = page) => target.locator('article').filter({ hasText: filename })
const deleteFromUi = async (row) => {
  const response = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/attachments/'))
  await row.getByRole('button', { name: '删除' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认删除' }).click()
  return response
}
const setFile = async (name, data, mimeType = 'text/plain') => {
  await fileInput.setInputFiles({ name, mimeType, buffer: Buffer.isBuffer(data) ? data : Buffer.from(data) })
}
const uploadFromUi = async (filename, data, { mimeType = 'text/plain', scope = 'workspace', page: target = page } = {}) => {
  if (scope === 'personal') await target.getByRole('button', { name: '我的个人附件' }).click()
  await target.locator('#workspace-attachment-file').setInputFiles({
    name: filename,
    mimeType,
    buffer: Buffer.isBuffer(data) ? data : Buffer.from(data),
  })
  const response = target.waitForResponse((r) => r.request().method() === 'POST' && /\/attachments(?:\?|$)/.test(r.url()))
  await target.getByRole('button', { name: '上传附件' }).click()
  return response
}

try {
  await page.goto(`${seed.web}/w/${seed.workspace_a1}`)
  await page.getByRole('heading', { name: 'Alpha One' }).waitFor()
  await page.getByRole('button', { name: '选择工作区' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '选择工作区' }).count(), 1, 'workspace switcher is rendered')
  const attachmentNav = page.getByRole('link', { name: '附件', exact: true })
  await attachmentNav.first().waitFor()
  await attachmentNav.first().click()
  await page.getByRole('heading', { name: '附件', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, workspacePath(seed.workspace_a1))
  await page.getByText('此 Workspace 暂无附件。').waitFor()

  // Valid workspace upload, list refresh, content download, and owner delete.
  const createA = await uploadFromUi('a1-shared.txt', 'A1 shared bytes')
  assert.equal(createA.status(), 201)
  await fileRow('a1-shared.txt').waitFor()
  assert.equal(await page.getByText('共 1 个文件').count(), 1)
  const downloadPromise = page.waitForEvent('download')
  await fileRow('a1-shared.txt').getByRole('button', { name: '下载' }).click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), 'a1-shared.txt')
  assert.equal(fs.readFileSync(await download.path(), 'utf8'), 'A1 shared bytes')
  const deleteA = deleteFromUi(fileRow('a1-shared.txt'))
  assert.equal((await deleteA).status(), 204)
  await fileRow('a1-shared.txt').waitFor({ state: 'detached' })

  // Personal scope stores/list/downloads/deletes only this actor's file.
  const createPersonal = await uploadFromUi('a1-private.txt', 'actor A personal', { scope: 'personal' })
  assert.equal(createPersonal.status(), 201)
  await fileRow('a1-private.txt').waitFor()
  assert.equal(await fileRow('a1-shared.txt').count(), 0)
  const personalDownloadPromise = page.waitForEvent('download')
  await fileRow('a1-private.txt').getByRole('button', { name: '下载' }).click()
  const personalDownload = await personalDownloadPromise
  assert.equal(fs.readFileSync(await personalDownload.path(), 'utf8'), 'actor A personal')
  await page.getByRole('button', { name: 'Workspace 附件' }).click()
  await page.getByText('此 Workspace 暂无附件。').waitFor()

  // Client-side extension and maximum-size guards; no request should be sent.
  const beforeInvalid = writes.length
  await setFile('not-allowed.exe', 'blocked')
  assert.match(await alertText(), /文件类型不受支持/)
  assert.equal(writes.length, beforeInvalid)
  await setFile('over-limit.txt', Buffer.alloc(25 * 1024 * 1024 + 1, 97))
  assert.match(await alertText(), /超过 25 MiB/)
  assert.equal(writes.length, beforeInvalid)
  assert.equal(await page.getByText(/待上传：over-limit\.txt/).count(), 0)

  // The browser accepts the extension, while the real API rejects invalid PDF
  // bytes. The component must surface the server's rejection to the user.
  const badPdf = await uploadFromUi('invalid.pdf', 'not a PDF', { mimeType: 'application/pdf' })
  assert.equal(badPdf.status(), 415)
  await page.getByRole('alert').filter({ hasText: '文件内容与所选类型不匹配。' }).waitFor()

  // A real over-limit multipart request bypasses the client guard and confirms
  // the server refusal is still 413; the frontend's regular control refuses
  // the same file before upload.
  const tooLargeForm = new FormData()
  tooLargeForm.append('scope_kind', 'workspace')
  tooLargeForm.append('file', new Blob([Buffer.alloc(25 * 1024 * 1024 + 1, 97)], { type: 'text/plain' }), 'server-over.txt')
  const tooLargeResponse = await fetch(attachmentUrl(seed.workspace_a1), {
    method: 'POST',
    headers: { Authorization: `Bearer ${seed.actor_a_token}`, 'X-Workspace-ID': seed.workspace_a1 },
    body: tooLargeForm,
  })
  assert.equal(tooLargeResponse.status, 413)
  const tooLargeBody = await tooLargeResponse.json()
  assert.equal(tooLargeBody.code ?? tooLargeBody.detail?.code, 'FILE_TOO_LARGE')

  // Switch through the actual upper-left selector. Pending files and old-scope
  // rows must not follow the actor or be served from another Workspace cache.
  await setFile('pending-a1.txt', 'must clear on scope switch')
  await page.getByText(/待上传：pending-a1\.txt/).waitFor()
  await page.getByRole('button', { name: '选择工作区' }).click()
  const picker = page.getByPlaceholder('搜索空间或租户…')
  await picker.fill('Alpha Two')
  await page.getByText('Alpha Two', { exact: true }).last().click()
  await page.waitForURL(new RegExp(`/w/${seed.workspace_a2}$`))
  await page.getByRole('heading', { name: 'Alpha Two', exact: true }).waitFor()
  await page.getByRole('link', { name: '附件', exact: true }).first().click()
  await page.getByRole('heading', { name: '附件', exact: true }).waitFor()
  await page.getByText('此 Workspace 暂无附件。').waitFor()
  assert.equal(await page.getByText(/待上传：/).count(), 0, 'pending file is cleared after changing Workspace')

  // Member-level upload remains available, but workspace deletion controls do
  // not appear for the same actor with a member role in A2.
  const createA2 = await uploadFromUi('a2-member-file.txt', 'A2 scope only')
  assert.equal(createA2.status(), 201)
  const memberRow = fileRow('a2-member-file.txt')
  await memberRow.waitFor()
  assert.equal(await memberRow.getByRole('button', { name: '删除' }).count(), 0)
  assert.equal(await fileRow('a1-shared.txt').count(), 0)

  // Search and tenant grouping in the switcher work, then the queried file set
  // is isolated to tenant B / Workspace B1.
  await setFile('pending-a2.txt', 'also clear across tenant')
  await page.getByText(/待上传：pending-a2\.txt/).waitFor()
  await page.getByRole('button', { name: '选择工作区' }).click()
  await page.getByText('F17b Tenant Beta', { exact: true }).waitFor()
  await page.getByPlaceholder('搜索空间或租户…').fill('Beta One')
  await page.getByText('Beta One', { exact: true }).last().click()
  await page.waitForURL(new RegExp(`/w/${seed.workspace_b1}$`))
  await page.getByRole('heading', { name: 'Beta One', exact: true }).waitFor()
  await page.getByRole('link', { name: '附件', exact: true }).first().click()
  await page.getByRole('heading', { name: '附件', exact: true }).waitFor()
  await page.getByText('此 Workspace 暂无附件。').waitFor()
  assert.equal(await page.getByText(/待上传：/).count(), 0)
  const createB = await uploadFromUi('b1-admin-file.txt', 'tenant B bytes')
  assert.equal(createB.status(), 201)
  const adminRow = fileRow('b1-admin-file.txt')
  await adminRow.waitFor()
  assert.equal(await adminRow.getByRole('button', { name: '删除' }).count(), 1, 'admin can delete workspace attachment')
  const deleteB = deleteFromUi(adminRow)
  assert.equal((await deleteB).status(), 204)
  await adminRow.waitFor({ state: 'detached' })

  // A second actor can read the shared A1 attachment but has no delete control.
  const memberContext = await browser.newContext({ acceptDownloads: true })
  await memberContext.addInitScript(() => {
    window.localStorage.setItem('synapse-locale', 'zh-CN')
  })
  await memberContext.addCookies([{ name: 'synapse_access_token', value: seed.actor_b_token, url: seed.web }])
  const memberPage = await memberContext.newPage()
  memberPage.setDefaultTimeout(15000)
  await memberPage.goto(`${seed.web}${workspacePath(seed.workspace_a1)}`)
  await memberPage.getByRole('heading', { name: '附件', exact: true }).waitFor()
  await memberPage.getByText('此 Workspace 暂无附件。').waitFor()
  assert.equal(await memberPage.getByRole('button', { name: '选择工作区' }).count(), 1)
  await memberPage.getByRole('button', { name: '我的个人附件' }).click()
  await memberPage.getByText('你还没有个人附件。').waitFor()
  assert.equal(await fileRow('a1-private.txt', memberPage).count(), 0, 'personal files are hidden from other Workspace actors')
  await memberPage.getByRole('button', { name: 'Workspace 附件' }).click()
  await memberPage.getByText('此 Workspace 暂无附件。').waitFor()
  const sharedSeed = await fetch(attachmentUrl(seed.workspace_a1), {
    method: 'POST',
    headers: { Authorization: `Bearer ${seed.actor_a_token}`, 'X-Workspace-ID': seed.workspace_a1 },
    body: (() => { const data = new FormData(); data.append('file', new Blob(['visible to A1 members'], { type: 'text/plain' }), 'member-visible.txt'); return data })(),
  })
  assert.equal(sharedSeed.status, 201)
  await memberPage.reload()
  await memberPage.getByText('member-visible.txt', { exact: true }).waitFor()
  const memberVisibleRow = fileRow('member-visible.txt', memberPage)
  assert.equal(await memberVisibleRow.getByRole('button', { name: '删除' }).count(), 0)

  // Select a file, revoke the membership server-side, then attempt upload. The
  // API's 403 must be shown; route revalidation falls back to an allowed B1.
  await memberPage.locator('#workspace-attachment-file').setInputFiles({
    name: 'revoke-pending.txt', mimeType: 'text/plain', buffer: Buffer.from('revoked'),
  })
  await memberPage.getByText(/待上传：revoke-pending\.txt/).waitFor()
  const revoke = await fetch(`${new URL(seed.api).origin}/__verification/f17b/revoke-member`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: seed.control_secret, workspace_id: seed.workspace_a1, user_id: seed.actor_b_id }),
  })
  assert.equal(revoke.status, 200)
  assert.equal((await revoke.json()).updated, 1)
  const deniedUpload = memberPage.waitForResponse((r) => r.request().method() === 'POST' && /\/attachments(?:\?|$)/.test(r.url()))
  await memberPage.getByRole('button', { name: '上传附件' }).click()
  const denied = await deniedUpload
  assert.equal(denied.status(), 403)
  await memberPage.getByRole('alert').waitFor()
  assert.notEqual((await memberPage.getByRole('alert').last().innerText()).trim(), '')
  await memberPage.reload()
  await memberPage.waitForURL(new RegExp(`/w/${seed.workspace_b1}$`), { timeout: 20000 })
  await memberPage.getByRole('heading', { name: 'Beta One', exact: true }).waitFor()
  assert.equal(await memberPage.getByText(/待上传：revoke-pending\.txt/).count(), 0)
  assert.equal(await memberPage.getByText('member-visible.txt', { exact: true }).count(), 0)
  await memberContext.close()

  // The personal owner can still delete their own file after the other actor's
  // membership is revoked; personal control is independent of workspace role.
  await page.getByRole('button', { name: '选择工作区' }).click()
  await page.getByPlaceholder('搜索空间或租户…').fill('Alpha One')
  await page.getByText('Alpha One', { exact: true }).last().click()
  await page.waitForURL(new RegExp(`/w/${seed.workspace_a1}$`))
  await page.getByRole('heading', { name: 'Alpha One', exact: true }).waitFor()
  await page.getByRole('link', { name: '附件', exact: true }).first().click()
  await page.getByRole('heading', { name: '附件', exact: true }).waitFor()
  await page.getByRole('button', { name: '我的个人附件' }).click()
  await fileRow('a1-private.txt').waitFor()
  const deletePersonal = deleteFromUi(fileRow('a1-private.txt'))
  assert.equal((await deletePersonal).status(), 204)
  await fileRow('a1-private.txt').waitFor({ state: 'detached' })

  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`)
  console.log('F17b Workspace attachment frontend verification passed')
} finally {
  await browser.close()
}
