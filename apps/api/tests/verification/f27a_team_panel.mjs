import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(`${process.cwd()}/package.json`)
const { chromium } = require('playwright')
const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()
page.setDefaultTimeout(20000)
page.on('pageerror', (error) => console.error('Browser page error:', error.message))
const failures = []

const setToken = async (token) => {
  await context.clearCookies()
  await context.addCookies([{ name: 'synapse_access_token', value: token, url: seed.web }])
}
const sessionsPath = (workspace) => `${seed.web}/w/${workspace}/sessions`
const control = async (path) => {
  const response = await fetch(`${seed.control}${path}`, { method: 'POST' })
  const text = await response.text()
  assert.equal(response.status, 200, text)
  return JSON.parse(text)
}
const openSession = async (workspace, agentId, sessionName) => {
  await page.goto(sessionsPath(workspace))
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.getByLabel('智能体').selectOption(agentId)
  const row = page.getByRole('button', { name: new RegExp(sessionName) })
  await row.waitFor()
  await row.click()
  await page.getByRole('heading', { name: sessionName, exact: true }).waitFor()
}

try {
  await setToken(seed.actor_token)
  await openSession(seed.workspace_one, seed.leader_agent, 'F27a Full Team')

  const sessionList = await page.evaluate(async ({ agentId, workspace, token }) => {
    const response = await fetch(`/api/v1/ai/sessions/?agent_id=${encodeURIComponent(agentId)}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-ID': workspace },
    })
    return { status: response.status, body: await response.json() }
  }, { agentId: seed.leader_agent, workspace: seed.workspace_one, token: seed.actor_token })
  assert.equal(sessionList.status, 200, JSON.stringify(sessionList.body))
  const sessionViews = sessionList.body.sessions
  const leaderView = sessionViews.find((entry) => entry.session.id === seed.leader_session)
  console.log('F27a session API evidence:', JSON.stringify({
    status: leaderView?.status,
    team_id: leaderView?.session?.team_id,
    team_name: leaderView?.team?.team?.data?.name,
    member_count: leaderView?.team?.members?.length,
    task_states: leaderView?.session?.state?.tasks_context?.tasks?.map((task) => task.state),
  }))

  await page.getByText(/F27a Research Team/).waitFor()
  await page.getByText(/真实团队只读概览/).waitFor()
  const memberRegion = page.getByRole('region', { name: '团队成员' })
  const taskRegion = page.getByRole('region', { name: '任务进度' })
  await memberRegion.getByText(/F27a Worker One/).waitFor()
  await memberRegion.getByText(/F27a Worker Two/).waitFor()
  await taskRegion.getByText('1/3 已完成 · 33%', { exact: true }).waitFor()
  await taskRegion.getByText('进行中', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '重命名 / 配置' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '删除', exact: true }).count(), 0)

  const workerLink = memberRegion.getByRole('button', { name: /打开关联会话/ }).first()
  await workerLink.click()
  await page.getByText('当前查看的是子智能体会话；打开负责人会话可查看团队任务进度。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '重命名 / 配置' }).count(), 0)

  await openSession(seed.workspace_one, seed.leader_agent, 'F27a Full Team')
  const refreshedTaskRegion = page.getByRole('region', { name: '任务进度' })
  await refreshedTaskRegion.getByText('1/3 已完成 · 33%', { exact: true }).waitFor()

  // Change the real leader session state, then use a real AgentScope event to
  // trigger the same session-list invalidation used by the chat UI.
  await control('/__f27a/update-tasks')
  await control('/__f27a/publish')
  const updatedSessionList = await page.evaluate(async ({ agentId, workspace, token, leaderSession }) => {
    const response = await fetch(`/api/v1/ai/sessions/?agent_id=${encodeURIComponent(agentId)}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-ID': workspace },
    })
    const body = await response.json()
    const leader = body.sessions?.find((entry) => entry.session.id === leaderSession)
    return leader?.session?.state?.tasks_context?.tasks?.map((task) => task.state) ?? []
  }, { agentId: seed.leader_agent, workspace: seed.workspace_one, token: seed.actor_token, leaderSession: seed.leader_session })
  console.log('F27a updated session API task states:', JSON.stringify(updatedSessionList))
  try {
    await refreshedTaskRegion.getByText('2/3 已完成 · 67%', { exact: true }).waitFor()
    await refreshedTaskRegion.getByText('已完成', { exact: true }).nth(1).waitFor()
  } catch {
    failures.push('session event did not refresh the visible team task progress')
    console.error('F27a limitation: session.team/tasks_context API updated, but the visible panel stayed stale after the event.')
  }

  await openSession(seed.workspace_one, seed.empty_agent, 'F27a Empty Team')
  await page.getByRole('heading', { name: 'F27a Empty Team', exact: true }).waitFor()
  const emptyMemberRegion = page.getByRole('region', { name: '团队成员' })
  const emptyTaskRegion = page.getByRole('region', { name: '任务进度' })
  await emptyMemberRegion.getByText('团队当前没有子智能体成员。', { exact: true }).waitFor()
  await emptyTaskRegion.getByText('0/0 已完成 · 0%', { exact: true }).waitFor()
  await emptyTaskRegion.getByText('AgentScope 尚未为此负责人会话创建任务。', { exact: true }).waitFor()

  await openSession(seed.workspace_two, seed.workspace_two_agent, 'F27a Workspace Two Session')
  assert.equal(await page.getByRole('heading', { name: '子智能体团队', exact: true }).count(), 0)
  assert.equal(await page.getByText(/F27a Research Team/).count(), 0)
  assert.equal(await page.getByText('F27a Full Team', { exact: true }).count(), 0)

  await control('/__f27a/revoke')
  await page.goto(sessionsPath(seed.workspace_one))
  const revokedResponse = await page.evaluate(async ({ agentId, workspace, token }) => {
    const response = await fetch(`/api/v1/ai/sessions/?agent_id=${encodeURIComponent(agentId)}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-ID': workspace },
    })
    return { status: response.status, text: await response.text() }
  }, { agentId: seed.leader_agent, workspace: seed.workspace_one, token: seed.actor_token })
  assert.equal(revokedResponse.status, 403, revokedResponse.text)
  console.log('F27a revoked page feedback: HTTP 403 from the real Workspace gateway')

  await setToken(seed.peer_token)
  await page.goto(sessionsPath(seed.workspace_one))
  await page.getByRole('heading', { name: '会话管理', exact: true }).waitFor()
  await page.getByRole('heading', { name: '请先创建智能体', exact: true }).waitFor()
  assert.equal(await page.getByText(/F27a Research Team/).count(), 0)

  assert.deepEqual(failures, [], failures.join('; '))
  console.log('F27a team panel verification passed')
} finally {
  await browser.close()
}
