import * as React from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { useLocaleText } from '@/lib/i18n'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { Bot, Loader2, MessageSquare, Paperclip, Plus, Send, Settings2, Square, Trash2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DetailDialog } from '@/components/detail-dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiProblem, api } from '@/lib/api'
import {
  downloadAttachment,
  listAttachments,
} from '@/api/attachments'
import { useAuthStore } from '@/stores/auth-store'
import { Textarea } from '@/components/ui/textarea'
import { useWorkspace } from './context'
import type { Workspace } from './types'
import { LocalizedText } from '@/components/localized-text'

type AgentView = { id: string; data: { name: string }; editable: boolean }
type AgentList = { agents: AgentView[]; total: number }
type SessionStatus = 'running' | 'idle' | 'awaiting_permission' | 'awaiting_external_result'
type SessionView = {
  session: {
    id: string
    agent_id: string
    user_id: string
    origin: { type: string }
    team_id: string | null
    created_at?: string
    updated_at?: string
    config: { name: string; workspace_id: string; cwd?: string | null }
    state: { permission_context?: { mode?: string } }
  }
  is_running: boolean
  status: SessionStatus
  team?: TeamDetail | null
}
type TeamDetail = {
  team: { id: string; session_id: string; data: { name: string; description?: string; members?: Array<{ agent_id: string; session_id: string; role?: string }> } }
  leader_agent: { id: string; data: { name: string } } | null
  members: Array<{ agent: { id: string; data: { name: string } }; session_id: string | null }>
}
type AgentTask = { id: string; subject: string; description?: string; state: 'pending' | 'in_progress' | 'completed'; owner?: string | null }
type SessionList = { sessions: SessionView[]; total: number }
type SessionMutation = { name: string; permissionMode: string }

const scopedKey = (actorId: string, workspace: Workspace, resource: string) =>
  ['synapse', actorId, workspace.tenant_id, workspace.workspace_id, resource, workspace.membership_version ?? 0] as const
const headers = (workspace: Workspace) => ({ 'X-Workspace-ID': workspace.workspace_id })
const aiPath = '/ai'
const permissionModes = ['default', 'accept_edits', 'explore', 'bypass', 'dont_ask'] as const

function formatError(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 403) return '当前 Workspace 成员没有此操作权限。'
    if (error.status === 404) return '会话或智能体不存在，或不属于当前 Workspace。'
    if (error.status === 409) return '会话正在运行或 Workspace 权限已变化，请稍后重试。'
  }
  return error instanceof Error ? error.message : '操作失败，请重试。'
}

const statusLabel: Record<SessionStatus, string> = {
  running: '运行中', idle: '空闲', awaiting_permission: '等待授权', awaiting_external_result: '等待外部结果',
}
const emptyAgents: AgentView[] = []
const emptySessions: SessionView[] = []

export function WorkspaceSessionsPage() {
  const { workspace, actorId } = useWorkspace()
  return <WorkspaceSessionsContent key={`${actorId}:${workspace.tenant_id}:${workspace.workspace_id}`} workspace={workspace} actorId={actorId} />
}

function WorkspaceSessionsContent({ workspace, actorId }: { workspace: Workspace; actorId: string }) {
  const client = useQueryClient()
  const [agentId, setAgentId] = React.useState('')
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [editor, setEditor] = React.useState<'create' | 'edit' | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: string; name: string } | null>(null)
  const [draftName, setDraftName] = React.useState('')
  const [draftPermission, setDraftPermission] = React.useState('default')
  const [formError, setFormError] = React.useState('')
  const canWrite = workspace.status === 'active'
  const agentsKey = scopedKey(actorId, workspace, 'ai-agents')
  const sessionListKey = React.useMemo(
    () => [...scopedKey(actorId, workspace, 'ai-sessions'), agentId] as const,
    [actorId, workspace.tenant_id, workspace.workspace_id, workspace.membership_version, agentId],
  )

  const agents = useQuery({
    queryKey: agentsKey,
    queryFn: () => api<AgentList>(`${aiPath}/agent/`, { headers: headers(workspace) }),
  })
  const availableAgents = agents.data?.agents ?? emptyAgents
  const selectedAgent = availableAgents.find((agent) => agent.id === agentId) ?? null

  if (agents.data && (!agentId || !availableAgents.some((agent) => agent.id === agentId))) {
    const nextAgentId = availableAgents[0]?.id ?? ''
    if (nextAgentId !== agentId) {
      setAgentId(nextAgentId)
      setSessionId(null)
    }
  }

  const sessions = useQuery({
    queryKey: sessionListKey,
    queryFn: () => api<SessionList>(`${aiPath}/sessions/?agent_id=${encodeURIComponent(agentId)}`, { headers: headers(workspace) }),
    enabled: Boolean(agentId),
    refetchInterval: (query) => query.state.data?.sessions.some((entry) => entry.status === 'running') ? 3000 : sessionId ? 3000 : false,
  })
  const entries = sessions.data?.sessions ?? emptySessions
  const selected = entries.find((entry) => entry.session.id === sessionId) ?? null

  if (sessions.data && sessionId && !entries.some((entry) => entry.session.id === sessionId)) {
    setSessionId(null)
  }

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: sessionListKey })
  }
  const createSession = useMutation({
    mutationFn: (name: string) => api<{ session_id: string }>(`${aiPath}/sessions/`, {
      method: 'POST', headers: headers(workspace), body: JSON.stringify({
        agent_id: agentId,
        ...(name.trim() ? { name: name.trim() } : {}),
      }),
    }),
    onSuccess: async ({ session_id }) => {
      await refresh()
      setSessionId(session_id)
      setEditor(null)
      setFormError('')
    },
  })
  const updateSession = useMutation({
    mutationFn: ({ id, value }: { id: string; value: SessionMutation }) => api(`${aiPath}/sessions/${encodeURIComponent(id)}?agent_id=${encodeURIComponent(agentId)}`, {
      method: 'PATCH', headers: headers(workspace), body: JSON.stringify({
        name: value.name.trim(), permission_mode: value.permissionMode,
      }),
    }),
    onSuccess: async () => {
      await refresh()
      setEditor(null)
      setFormError('')
    },
  })
  const deleteSession = useMutation({
    mutationFn: (id: string) => api<void>(`${aiPath}/sessions/${encodeURIComponent(id)}?agent_id=${encodeURIComponent(agentId)}`, { method: 'DELETE', headers: headers(workspace) }),
    onSuccess: async (_, id) => {
      setSessionId((current) => current === id ? null : current)
      await refresh()
    },
  })

  const openCreate = () => {
    createSession.reset(); updateSession.reset()
    setDraftName(''); setDraftPermission('default'); setFormError(''); setEditor('create')
  }
  const openEdit = () => {
    if (!selected) return
    createSession.reset(); updateSession.reset()
    setDraftName(selected.session.config.name ?? '')
    const mode = selected.session.state.permission_context?.mode ?? 'default'
    setDraftPermission(permissionModes.includes(mode as typeof permissionModes[number]) ? mode : 'default')
    setFormError(''); setEditor('edit')
  }
  const submit = () => {
    setFormError('')
    if (!draftName.trim() && editor === 'edit') { setFormError('会话名称不能为空。'); return }
    if (editor === 'create') createSession.mutate(draftName)
    else if (selected) updateSession.mutate({ id: selected.session.id, value: { name: draftName, permissionMode: draftPermission } })
  }
  const mutationError = createSession.error ?? updateSession.error
  const selectedIsUserSession = selected?.session.origin.type === 'user' && !selected.session.team_id

  return (
    <main className='space-y-6 p-6'>
      <header className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <p className='mt-3 text-sm text-muted-foreground'><LocalizedText text={"Workspace · "} />{workspace.name}</p>
          <h1 className='mt-1 text-2xl font-semibold'><LocalizedText text={"会话管理"} /></h1>
          <p className='mt-1 text-sm text-muted-foreground'><LocalizedText text={"按智能体查看、创建和管理当前 Workspace 中的会话，并在此收发消息。"} /></p>
        </div>
        <Link to='/w/$workspaceId/agents' params={{ workspaceId: workspace.workspace_id }}><Button variant='outline'><Bot className='mr-2 size-4' /><LocalizedText text={"智能体管理"} /></Button></Link>
      </header>

      {workspace.status !== 'active' && <Alert><AlertDescription><LocalizedText text={"此 Workspace 已归档，当前不能读取或修改会话。"} /></AlertDescription></Alert>}
      {agents.isError && <Alert variant='destructive'><AlertDescription>{formatError(agents.error)}</AlertDescription></Alert>}
      {sessions.isError && <Alert variant='destructive'><AlertDescription>{formatError(sessions.error)}</AlertDescription></Alert>}
      {deleteSession.isError && <Alert variant='destructive'><AlertDescription>{formatError(deleteSession.error)}</AlertDescription></Alert>}

      <section className='flex flex-wrap items-end justify-between gap-4 rounded-xl border bg-card p-5'>
        <div className='min-w-64 space-y-2'><Label htmlFor='sessions-agent-select'><LocalizedText text={"智能体"} /></Label><LocalizedNativeSelect id='sessions-agent-select' className='h-10 w-full rounded-md border bg-background px-3 text-sm' value={agentId} onChange={(event) => { setAgentId(event.target.value); setSessionId(null) }} disabled={agents.isLoading || !availableAgents.length}><option value=''><LocalizedText text={"请选择智能体"} /></option>{availableAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.data.name}</option>)}</LocalizedNativeSelect></div>
        {canWrite && <Button onClick={openCreate} disabled={!selectedAgent}><Plus className='mr-2 size-4' /><LocalizedText text={"新建会话"} /></Button>}
      </section>

      {!agents.isLoading && !agents.isError && !availableAgents.length && <Card><CardContent className='py-10 text-center'><Bot className='mx-auto size-8 text-muted-foreground' /><h2 className='mt-3 font-semibold'><LocalizedText text={"请先创建智能体"} /></h2><p className='mt-1 text-sm text-muted-foreground'><LocalizedText text={"会话必须关联当前 Workspace 中可访问的智能体。"} /></p><Link className='mt-4 inline-block' to='/w/$workspaceId/agents' params={{ workspaceId: workspace.workspace_id }}><Button variant='outline'><LocalizedText text={"打开智能体管理"} /></Button></Link></CardContent></Card>}

      {selectedAgent && <div className='grid gap-5'>
        <Card>
          <CardHeader><CardTitle><LocalizedText text={"会话列表"} /></CardTitle><CardDescription>{selectedAgent.data.name} <LocalizedText text={" · "} />{sessions.data?.total ?? 0} <LocalizedText text={" 个会话"} /></CardDescription></CardHeader>
          <CardContent className='space-y-2'>
            {sessions.isLoading ? <p className='py-5 text-sm text-muted-foreground'><LocalizedText text={"正在加载…"} /></p> : entries.length ? entries.map((entry) => <button key={entry.session.id} type='button' onClick={() => setSessionId(entry.session.id)} className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent ${sessionId === entry.session.id ? 'border-primary bg-accent' : ''}`}>
              <span className='flex items-center justify-between gap-2'><span className='flex min-w-0 items-center gap-2 font-medium'><MessageSquare className='size-4 shrink-0 text-muted-foreground' /><span className='truncate'>{entry.session.config.name || '未命名会话'}</span></span><span className='shrink-0 text-xs text-muted-foreground'>{statusLabel[entry.status] ?? entry.status}</span></span>
              <span className='mt-1 block truncate text-xs text-muted-foreground'>{entry.session.origin.type === 'user' ? <LocalizedText text={"手动创建"} /> : `来源：${entry.session.origin.type}`} <LocalizedText text={" · "} />{entry.session.id}</span>
            </button>) : !sessions.isError && <div className='rounded-lg border border-dashed p-6 text-center'><p className='text-sm font-medium'><LocalizedText text={"还没有会话"} /></p><p className='mt-1 text-xs text-muted-foreground'><LocalizedText text={"为此智能体创建一个会话。"} /></p>{canWrite && <Button className='mt-4' size='sm' variant='outline' onClick={openCreate}><Plus className='mr-2 size-4' /><LocalizedText text={"创建会话"} /></Button>}</div>}
          </CardContent>
        </Card>

        <Dialog open={Boolean(sessionId)} onOpenChange={(open) => { if (!open) setSessionId(null) }}>
          <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
            <DialogHeader>
              <DialogTitle><LocalizedText text={"会话信息"} /></DialogTitle>
              <DialogDescription><LocalizedText text={"查看状态和配置；有权限时可直接重命名、调整权限模式或删除。"} /></DialogDescription>
            </DialogHeader>
            <Card>
          <CardContent>
            {!sessionId ? <p className='py-8 text-center text-sm text-muted-foreground'><LocalizedText text={"尚未选择会话"} /></p> : !selected ? <p className='py-8 text-sm text-muted-foreground'><LocalizedText text={"正在同步会话列表…"} /></p> : <div className='space-y-5'>
              <div className='flex flex-wrap items-start justify-between gap-3'><div><h2 className='text-xl font-semibold'>{selected.session.config.name || '未命名会话'}</h2><p className='mt-1 break-all text-xs text-muted-foreground'><LocalizedText text={"ID："} />{selected.session.id}</p></div>{selectedIsUserSession && canWrite && <div className='flex gap-2'><Button size='sm' variant='outline' disabled={selected.is_running} onClick={openEdit}><Settings2 className='mr-2 size-3.5' /><LocalizedText text={"重命名 / 配置"} /></Button><Button size='sm' variant='destructive' disabled={selected.is_running || deleteSession.isPending} onClick={() => setDeleteTarget({ id: selected.session.id, name: selected.session.config.name || '未命名会话' })}><Trash2 className='mr-2 size-3.5' /><LocalizedText text={"删除"} /></Button></div>}</div>
              <dl className='grid gap-3 text-sm sm:grid-cols-2'><div><dt className='text-muted-foreground'><LocalizedText text={"智能体"} /></dt><dd className='mt-1'>{selectedAgent.data.name}</dd></div><div><dt className='text-muted-foreground'><LocalizedText text={"来源"} /></dt><dd className='mt-1'>{selected.session.origin.type === 'user' ? <LocalizedText text={"手动创建"} /> : selected.session.origin.type}</dd></div><div><dt className='text-muted-foreground'><LocalizedText text={"状态"} /></dt><dd className='mt-1'>{statusLabel[selected.status] ?? selected.status}</dd></div><div><dt className='text-muted-foreground'><LocalizedText text={"权限模式"} /></dt><dd className='mt-1'>{selected.session.state.permission_context?.mode ?? 'default'}</dd></div><div className='sm:col-span-2'><dt className='text-muted-foreground'><LocalizedText text={"Workspace 绑定"} /></dt><dd className='mt-1 break-all'>{selected.session.config.workspace_id}</dd></div>{selected.session.config.cwd && <div className='sm:col-span-2'><dt className='text-muted-foreground'><LocalizedText text={"当前工作目录"} /></dt><dd className='mt-1 break-all'>{selected.session.config.cwd}</dd></div>}</dl>
              {!selectedIsUserSession && <p className='text-sm text-muted-foreground'><LocalizedText text={"此会话由系统流程或团队创建，仅可查看；手动会话可在此重命名、调整权限模式或删除。"} /></p>}
              {selected.is_running && <p className='text-sm text-muted-foreground'><LocalizedText text={"会话运行期间暂不能修改或删除。"} /></p>}
              {selected.team && <TeamOverview
                team={selected.team}
                isLeaderSession={selected.session.id === selected.team.team.session_id}
                leaderTasks={selected.session.id === selected.team.team.session_id ? (selected.session.state as typeof selected.session.state & { tasks_context?: { tasks?: AgentTask[] } }).tasks_context?.tasks ?? [] : []}
                onOpenSession={(memberAgentId, memberSessionId) => { setAgentId(memberAgentId); setSessionId(memberSessionId) }}
              />}
            </div>}
          </CardContent>
            </Card>
          </DialogContent>
        </Dialog>
      </div>}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open && !deleteSession.isPending) setDeleteTarget(null) }}
        title='删除会话'
        desc='删除后会话配置和消息将不再出现在当前 Workspace。'
        confirmText='确认删除'
        destructive
        isLoading={deleteSession.isPending}
        handleConfirm={() => {
          if (deleteTarget) {
            deleteSession.mutate(deleteTarget.id, {
              onSuccess: () => setDeleteTarget(null),
            })
          }
        }}
      >
        {deleteTarget && <p className='text-sm font-medium'>{deleteTarget.name}</p>}
      </ConfirmDialog>

      {selected && selectedAgent && workspace.status === 'active' && <SessionMessagesPanel
        key={`${actorId}:${workspace.tenant_id}:${workspace.workspace_id}:${agentId}:${selected.session.id}`}
        actorId={actorId}
        workspace={workspace}
        agentId={agentId}
        sessionId={selected.session.id}
        sessionName={selected.session.config.name}
        initiallyRunning={selected.is_running}
        initialStatus={selected.status}
        sessionListKey={sessionListKey}
      />}

      <Dialog open={editor !== null} onOpenChange={(open) => { if (!open && !createSession.isPending && !updateSession.isPending) setEditor(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editor === 'create' ? <LocalizedText text={"新建会话"} /> : <LocalizedText text={"重命名 / 配置会话"} />}</DialogTitle><DialogDescription>{editor === 'create' ? `为“${selectedAgent?.data.name ?? ''}”创建会话。留空时由服务端生成名称。` : <LocalizedText text={"正在运行的会话不能修改配置。"} />}</DialogDescription></DialogHeader>
          <div className='space-y-4'><div className='space-y-2'><Label htmlFor='session-name'><LocalizedText text={"会话名称"} /></Label><Input id='session-name' maxLength={200} value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder='例如：产品方案讨论' /></div>{editor === 'edit' && <div className='space-y-2'><Label htmlFor='session-permission'><LocalizedText text={"工具权限模式"} /></Label><LocalizedNativeSelect id='session-permission' className='h-10 w-full rounded-md border bg-background px-3 text-sm' value={draftPermission} onChange={(event) => setDraftPermission(event.target.value)}>{permissionModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</LocalizedNativeSelect><p className='text-xs text-muted-foreground'><LocalizedText text={"权限模式会影响智能体工具的批准方式；BYPASS 会跳过多数确认，请谨慎使用。"} /></p></div>}</div>
          {(formError || mutationError) && <Alert variant='destructive'><AlertDescription>{formError || formatError(mutationError)}</AlertDescription></Alert>}
          <DialogFooter><Button variant='outline' disabled={createSession.isPending || updateSession.isPending} onClick={() => setEditor(null)}><LocalizedText text={"取消"} /></Button><Button disabled={createSession.isPending || updateSession.isPending || (editor === 'edit' && !draftName.trim())} onClick={submit}>{createSession.isPending || updateSession.isPending ? <LocalizedText text={"保存中…"} /> : editor === 'create' ? <LocalizedText text={"创建会话"} /> : <LocalizedText text={"保存修改"} />}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function TeamOverview({ team, isLeaderSession, leaderTasks, onOpenSession }: {
  team: TeamDetail
  isLeaderSession: boolean
  leaderTasks: AgentTask[]
  onOpenSession: (agentId: string, sessionId: string) => void
}) {
  const t = useLocaleText()
  const completed = leaderTasks.filter((task) => task.state === 'completed').length
  const progress = leaderTasks.length ? Math.round(completed / leaderTasks.length * 100) : 0
  return <Card>
    <CardHeader>
      <CardTitle><LocalizedText text={"子智能体团队"} /></CardTitle>
      <CardDescription>{team.team.data.name}{team.team.data.description ? ` · ${team.team.data.description}` : <LocalizedText text={""} />} <LocalizedText text={" · "} />{team.members.length + (team.leader_agent ? 1 : 0)} <LocalizedText text={" 位成员"} /></CardDescription>
    </CardHeader>
    <CardContent className='space-y-5'>
      <section aria-label={t('团队成员')} className='space-y-2'>
        <h3 className='text-sm font-medium'><LocalizedText text={"成员与关联会话"} /></h3>
        {team.leader_agent && <div className='flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm'><span>{team.leader_agent.data.name} <span className='text-muted-foreground'><LocalizedText text={"· 负责人"} /></span></span><span className='text-xs text-muted-foreground'><LocalizedText text={"当前会话"} /></span></div>}
        {team.members.length ? team.members.map(({ agent, session_id }) => <div key={`${agent.id}:${session_id ?? ''}`} className='flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm'>
          <span>{agent.data.name} <span className='text-muted-foreground'><LocalizedText text={"· 子智能体"} /></span></span>
          {session_id ? <button type='button' className='break-all text-left text-xs text-primary underline underline-offset-4' onClick={() => onOpenSession(agent.id, session_id)}><LocalizedText text={"打开关联会话 · "} />{session_id}</button> : <span className='text-xs text-muted-foreground'><LocalizedText text={"暂无关联会话"} /></span>}
        </div>) : <p className='text-sm text-muted-foreground'><LocalizedText text={"团队当前没有子智能体成员。"} /></p>}
      </section>
      <section aria-label={t('任务进度')} className='space-y-2'>
        <div className='flex items-center justify-between gap-3'><h3 className='text-sm font-medium'><LocalizedText text={"负责人任务"} /></h3><span className='text-xs text-muted-foreground'>{completed}<LocalizedText text={"/"} />{leaderTasks.length} <LocalizedText text={" 已完成 · "} />{progress}<LocalizedText text={"%"} /></span></div>
        <div className='h-2 overflow-hidden rounded-full bg-muted' role='progressbar' aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className='h-full bg-primary transition-all' style={{ width: `${progress}%` }} /></div>
        {!isLeaderSession ? <p className='text-sm text-muted-foreground'><LocalizedText text={"当前查看的是子智能体会话；打开负责人会话可查看团队任务进度。"} /></p> : leaderTasks.length ? <ul className='space-y-2'>{leaderTasks.map((task) => <li key={task.id} className='flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-sm'><span>{task.subject}{task.owner && <span className='ml-2 text-xs text-muted-foreground'><LocalizedText text={"· "} />{task.owner}</span>}</span><span className='shrink-0 text-xs text-muted-foreground'>{task.state === 'completed' ? <LocalizedText text={"已完成"} /> : task.state === 'in_progress' ? <LocalizedText text={"进行中"} /> : <LocalizedText text={"待处理"} />}</span></li>)}</ul> : <p className='text-sm text-muted-foreground'><LocalizedText text={"AgentScope 尚未为此负责人会话创建任务。"} /></p>}
      </section>
    </CardContent>
  </Card>
}

type ChatBlock = {
  type: string
  id?: string
  text?: string
  thinking?: string
  input?: string
  output?: string | Array<{ type?: string; text?: string; name?: string; media_type?: string }>
  state?: string
  suggested_rules?: unknown[]
  created_at?: string
  finished_at?: string | null
  name?: string | null
  source?: { type?: string; media_type?: string; url?: string }
}
type ChatMessage = { id: string; role: 'user' | 'assistant' | 'system'; name: string; content: ChatBlock[]; created_at?: string }
type MessagePage = { messages: ChatMessage[]; is_running: boolean; has_more: boolean }
type ChatStatus = { session_id: string; status: SessionStatus }
type DataBlock = { type: 'data'; name: string; source: { type: 'base64'; data: string; media_type: string } }
type StreamEvent = {
  id?: string
  sequence?: number
  seq?: number
  payload?: string | StreamEvent
  type?: string
  reply_id?: string
  block_id?: string
  tool_call_id?: string
  tool_call_name?: string
  delta?: string
  text?: string | null
  state?: string
  media_type?: string
  name?: string
  data?: string | null
  created_at?: string
  tool_calls?: PendingToolCall[]
  execution_results?: Array<{ id: string }>
  confirm_results?: Array<{ confirmed: boolean; tool_call: { id: string } }>
  value?: { event_type?: string; reply_id?: string; event?: StreamEvent; worker_session_id?: string }
}
type LiveReply = { id: string; name: string; blocks: Array<{ id: string; text: string }> }
type PendingToolCall = { type?: 'tool_call'; id: string; name: string; input: string; state?: string; suggested_rules?: unknown[]; created_at?: string; finished_at?: string | null }
type PendingConfirmation = { key: string; replyId: string; toolCall: PendingToolCall; status: 'pending' | 'submitting' | 'stale'; error?: string }
type PendingExternalResult = { key: string; replyId: string; toolCall: PendingToolCall; status: 'pending' | 'submitting' | 'stale'; output: string; error?: string }
type ToolExecution = {
  id: string
  replyId: string
  name: string
  state: 'requesting' | 'awaiting_confirmation' | 'awaiting_external_result' | 'running' | 'success' | 'error' | 'interrupted' | 'denied' | 'finished'
  startedAt?: string
  finishedAt?: string
  argumentsSummary?: string
  resultText?: string
  resultTruncated?: boolean
}

const MAX_CHAT_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MAX_TOOL_ARGUMENTS_CHARS = 1200
const MAX_TOOL_RESULT_CHARS = 6000
const MAX_EXTERNAL_RESULT_CHARS = 4000

function redactToolText(value: string): string {
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, '[已隐藏的私钥]')
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[已隐藏]')
    .replace(/((?:password|passwd|passphrase|token|secret|credential|api[_-]?key|authorization|cookie|private[_-]?key)\s*["']?\s*[:=]\s*["']?)[^"'\s,}\]]+/gi, '$1[已隐藏]')
}

function safeToolValue(value: unknown, key = ''): unknown {
  if (/(password|passwd|passphrase|token|secret|credential|api[_-]?key|authorization|cookie|private[_-]?key)/i.test(key)) return '[已隐藏]'
  if (typeof value === 'string') return redactToolText(value).slice(0, 240)
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => safeToolValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 12).map(([childKey, child]) => [childKey, safeToolValue(child, childKey)]))
  }
  return value
}

function summarizeToolArguments(raw: string): string {
  try {
    return JSON.stringify(safeToolValue(JSON.parse(raw))).slice(0, MAX_TOOL_ARGUMENTS_CHARS)
  } catch {
    return '参数摘要不可用'
  }
}

function summarizeToolResult(output: unknown): { text: string; truncated: boolean } {
  let text: string
  if (typeof output === 'string') text = output
  else if (Array.isArray(output)) {
    text = output.map((block) => {
      if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') return block.text
      if (block && typeof block === 'object' && ('media_type' in block || 'type' in block)) {
        const mediaType = 'media_type' in block && typeof block.media_type === 'string' ? block.media_type : '附件'
        const name = 'name' in block && typeof block.name === 'string' ? ` ${block.name}` : ''
        return `[已隐藏附件内容：${mediaType}${name}]`
      }
      return '[已隐藏非文本结果]'
    }).join('\n')
  } else text = ''
  const sanitized = redactToolText(text)
  return { text: sanitized.slice(0, MAX_TOOL_RESULT_CHARS), truncated: sanitized.length > MAX_TOOL_RESULT_CHARS }
}

function ensureToolExecution(items: ToolExecution[], id: string, replyId: string, name: string): ToolExecution[] {
  return items.some((item) => item.id === id)
    ? items
    : [...items, { id, replyId, name: name || '工具', state: 'requesting' }]
}

function collectHistoricalTools(messages: ChatMessage[]): ToolExecution[] {
  const items = new Map<string, ToolExecution>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'tool_call' && block.type !== 'tool_result') continue
      const id = block.id
      if (!id) continue
      const current = items.get(id) ?? { id, replyId: message.id, name: block.name || '工具', state: 'requesting' as const }
      if (block.type === 'tool_call') {
        const callState = block.state
        items.set(id, {
          ...current,
          name: block.name || current.name,
          state: callState === 'finished' ? 'finished' : callState === 'asking' ? 'awaiting_confirmation' : callState === 'submitted' ? 'awaiting_external_result' : 'requesting',
          startedAt: block.created_at ?? current.startedAt,
          ...(block.input ? { argumentsSummary: summarizeToolArguments(block.input) } : {}),
        })
      } else {
        const result = summarizeToolResult(block.output)
        const state = ['success', 'error', 'interrupted', 'denied', 'running'].includes(block.state ?? '')
          ? block.state as ToolExecution['state']
          : 'finished'
        items.set(id, { ...current, name: block.name || current.name, state, finishedAt: block.finished_at ?? current.finishedAt, resultText: result.text, resultTruncated: result.truncated })
      }
    }
  }
  return [...items.values()]
}

function collectHistoricalConfirmations(messages: ChatMessage[]): PendingConfirmation[] {
  const pending = new Map<string, PendingConfirmation>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'tool_call' || block.state !== 'asking' || !block.id || typeof block.input !== 'string') continue
      const key = `${message.id}:${block.id}`
      pending.set(key, {
        key,
        replyId: message.id,
        status: 'pending',
        toolCall: {
          type: 'tool_call', id: block.id, name: block.name || '工具', input: block.input,
          state: block.state, suggested_rules: block.suggested_rules,
          created_at: block.created_at, finished_at: block.finished_at,
        },
      })
    }
  }
  return [...pending.values()]
}

function collectHistoricalExternalRequests(messages: ChatMessage[]): PendingExternalResult[] {
  const pending = new Map<string, PendingExternalResult>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'tool_call' || block.state !== 'submitted' || !block.id || typeof block.input !== 'string') continue
      const key = `${message.id}:${block.id}`
      pending.set(key, {
        key, replyId: message.id, status: 'pending', output: '',
        toolCall: { type: 'tool_call', id: block.id, name: block.name || '外部任务', input: block.input, state: block.state },
      })
    }
  }
  return [...pending.values()]
}

function toolStateLabel(state: ToolExecution['state']): string {
  return ({
    requesting: '等待执行', awaiting_confirmation: '等待确认', awaiting_external_result: '等待外部结果', running: '执行中', success: '成功', error: '失败',
    interrupted: '已中断', denied: '已拒绝', finished: '已结束',
  })[state]
}

function formatTimelineTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString()
}

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
    }
    return btoa(binary)
  })
}

function ensureLiveReply(replies: LiveReply[], id: string): LiveReply[] {
  return replies.some((reply) => reply.id === id)
    ? replies
    : [...replies, { id, name: '智能体', blocks: [] }]
}

function SessionMessagesPanel({
  actorId, workspace, agentId, sessionId, sessionName, initiallyRunning, initialStatus, sessionListKey,
}: {
  actorId: string
  workspace: Workspace
  agentId: string
  sessionId: string
  sessionName: string
  initiallyRunning: boolean
  initialStatus: SessionStatus
  sessionListKey: readonly unknown[]
}) {
  const t = useLocaleText()
  const client = useQueryClient()
  const headers = React.useMemo(() => ({ 'X-Workspace-ID': workspace.workspace_id }), [workspace.workspace_id])
  const [text, setText] = React.useState('')
  const [selectedAttachments, setSelectedAttachments] = React.useState<string[]>([])
  const [sending, setSending] = React.useState(initiallyRunning)
  const [submitting, setSubmitting] = React.useState(false)
  const [sendError, setSendError] = React.useState('')
  const [accessDenied, setAccessDenied] = React.useState(false)
  const [streamError, setStreamError] = React.useState('')
  const [streamConnected, setStreamConnected] = React.useState(false)
  const [streamRetry, setStreamRetry] = React.useState(0)
  const [liveReplies, setLiveReplies] = React.useState<LiveReply[]>([])
  const [toolEvents, setToolEvents] = React.useState<ToolExecution[]>([])
  const [confirmationRequests, setConfirmationRequests] = React.useState<PendingConfirmation[]>([])
  const [externalRequests, setExternalRequests] = React.useState<PendingExternalResult[]>([])
  const [interruptPending, setInterruptPending] = React.useState(false)
  const [stopRequested, setStopRequested] = React.useState(false)
  const sendController = React.useRef<AbortController | null>(null)
  const interruptInFlight = React.useRef(false)
  const streamController = React.useRef<AbortController | null>(null)
  const streamGeneration = React.useRef(0)
  const seenEventIds = React.useRef(new Set<string>())
  const toolCallBuffers = React.useRef(new Map<string, string>())
  const resolvedConfirmationKeys = React.useRef(new Set<string>())
  const confirmationInFlight = React.useRef(new Set<string>())
  const confirmationControllers = React.useRef(new Map<string, AbortController>())
  const externalInFlight = React.useRef(new Set<string>())
  const externalControllers = React.useRef(new Map<string, AbortController>())
  const resolvedExternalKeys = React.useRef(new Set<string>())
  const confirmationRequestsRef = React.useRef<PendingConfirmation[]>([])
  const historyConfirmationsRef = React.useRef<PendingConfirmation[]>([])
  const externalRequestsRef = React.useRef<PendingExternalResult[]>([])
  const historyExternalRequestsRef = React.useRef<PendingExternalResult[]>([])
  const messagesKey = React.useMemo(
    () => [
      'synapse',
      actorId,
      workspace.tenant_id,
      workspace.workspace_id,
      'ai-messages',
      workspace.membership_version ?? 0,
      agentId,
      sessionId,
      headers,
    ] as const,
    [actorId, workspace.tenant_id, workspace.workspace_id, workspace.membership_version, agentId, sessionId, headers],
  )
  const attachmentKey = React.useMemo(
    () => [
      'synapse',
      actorId,
      workspace.tenant_id,
      workspace.workspace_id,
      'workspace-attachments-chat',
      workspace.membership_version ?? 0,
      headers,
    ] as const,
    [actorId, workspace.tenant_id, workspace.workspace_id, workspace.membership_version, headers],
  )

  const history = useInfiniteQuery<
    MessagePage,
    Error,
    InfiniteData<MessagePage, string | undefined>,
    typeof messagesKey,
    string | undefined
  >({
    queryKey: messagesKey,
    queryFn: ({ pageParam }) => {
      const before = pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''
      return api<MessagePage>(`${aiPath}/sessions/${encodeURIComponent(sessionId)}/messages?agent_id=${encodeURIComponent(agentId)}&limit=50${before}`, { headers })
    },
    initialPageParam: undefined,
    getPreviousPageParam: (oldestPage) => oldestPage.has_more ? oldestPage.messages[0]?.id : undefined,
    getNextPageParam: () => undefined,
    enabled: workspace.status === 'active',
  })
  const attachments = useQuery({
    queryKey: attachmentKey,
    queryFn: () =>
      listAttachments({
        workspaceId: workspace.workspace_id,
        scopeKind: 'workspace',
        page: 1,
        pageSize: 100,
        headers,
      }),
    enabled: workspace.status === 'active',
  })
  const allMessages = history.data?.pages.flatMap((page) => page.messages) ?? []
  const visibleLiveReplies = liveReplies.filter((reply) => !allMessages.some((message) => message.id === reply.id))
  const toolTimeline = React.useMemo(() => {
    const merged = new Map<string, ToolExecution>()
    for (const item of collectHistoricalTools(allMessages)) merged.set(item.id, item)
    for (const live of toolEvents) {
      const previous = merged.get(live.id)
      merged.set(live.id, {
        ...previous,
        ...live,
        argumentsSummary: live.argumentsSummary ?? previous?.argumentsSummary,
        resultText: live.resultText ?? previous?.resultText,
        resultTruncated: live.resultText !== undefined ? live.resultTruncated : previous?.resultTruncated,
      })
    }
    return [...merged.values()]
  }, [allMessages, toolEvents])
  confirmationRequestsRef.current = confirmationRequests
  externalRequestsRef.current = externalRequests
  const pickedAttachments = (attachments.data?.items ?? []).filter((item) => selectedAttachments.includes(item.attachment_id))
  const pickedBytes = pickedAttachments.reduce((sum, item) => sum + item.size_bytes, 0)
  const runStatusKey = React.useMemo(
    () => [
      'synapse',
      actorId,
      workspace.tenant_id,
      workspace.workspace_id,
      'ai-messages',
      workspace.membership_version ?? 0,
      agentId,
      sessionId,
      headers,
      'status',
    ] as const,
    [actorId, workspace.tenant_id, workspace.workspace_id, workspace.membership_version, agentId, sessionId, headers],
  )
  const runStatus = useQuery({
    queryKey: runStatusKey,
    queryFn: ({ queryKey }) => api<ChatStatus>(
      `${aiPath}/sessions/${encodeURIComponent(queryKey[7])}/status?agent_id=${encodeURIComponent(queryKey[6])}`,
      { headers: queryKey[8] },
    ),
    enabled: workspace.status === 'active' && (sending || interruptPending || stopRequested),
    refetchInterval: (query) => query.state.data?.status === 'running' ? 1000 : false,
    retry: false,
  })
  const activeConfirmations = React.useMemo(() => {
    const merged = new Map<string, PendingConfirmation>()
    if (initialStatus === 'awaiting_permission' || runStatus.data?.status === 'awaiting_permission') {
      for (const item of collectHistoricalConfirmations(allMessages)) merged.set(item.key, item)
    }
    for (const item of confirmationRequests) merged.set(item.key, item)
    return [...merged.values()].filter((item) => !resolvedConfirmationKeys.current.has(item.key))
  }, [allMessages, confirmationRequests, initialStatus, runStatus.data?.status])
  const activeExternalRequests = React.useMemo(() => {
    const merged = new Map<string, PendingExternalResult>()
    if (initialStatus === 'awaiting_external_result' || runStatus.data?.status === 'awaiting_external_result') {
      for (const item of collectHistoricalExternalRequests(allMessages)) merged.set(item.key, item)
    }
    for (const item of externalRequests) merged.set(item.key, item)
    return [...merged.values()].filter((item) => !resolvedExternalKeys.current.has(item.key))
  }, [allMessages, externalRequests, initialStatus, runStatus.data?.status])
  historyConfirmationsRef.current = collectHistoricalConfirmations(allMessages)
  historyExternalRequestsRef.current = collectHistoricalExternalRequests(allMessages)

  React.useEffect(() => {
    if (!history.isError) return
    const error = history.error
    if (error instanceof ApiProblem && [401, 403, 404, 409].includes(error.status)) {
      setAccessDenied(true)
      setText('')
      setSelectedAttachments([])
      setLiveReplies([])
      setToolEvents([])
      setConfirmationRequests([])
      setExternalRequests([])
      confirmationInFlight.current.clear()
      externalInFlight.current.clear()
      toolCallBuffers.current.clear()
      void client.removeQueries({ queryKey: messagesKey, exact: true })
      void client.removeQueries({ queryKey: attachmentKey, exact: true })
    }
  }, [attachmentKey, client, history.error, history.isError, messagesKey])

  React.useEffect(() => {
    const controller = new AbortController()
    streamController.current?.abort()
    streamController.current = controller
    const generation = ++streamGeneration.current
    let buffer = ''

    const registerConfirmationRequests = (replyId: string, calls: PendingToolCall[]) => {
      const validCalls = calls.filter((call) => call && typeof call.id === 'string' && typeof call.name === 'string' && typeof call.input === 'string')
      setConfirmationRequests((current) => {
        const next = [...current]
        for (const call of validCalls) {
          const key = `${replyId}:${call.id}`
          if (resolvedConfirmationKeys.current.has(key) || next.some((item) => item.key === key)) continue
          next.push({ key, replyId, toolCall: call, status: 'pending' })
        }
        return next
      })
      setToolEvents((current) => {
        let next = current
        for (const call of validCalls) {
          const items = ensureToolExecution(next, call.id, replyId, call.name)
          next = items.map((item) => item.id === call.id ? {
            ...item,
            state: 'awaiting_confirmation',
            argumentsSummary: summarizeToolArguments(call.input),
          } : item)
        }
        return next
      })
    }

    const resolveConfirmationsForReply = (replyId: string) => {
      for (const item of confirmationRequestsRef.current) {
        if (item.replyId === replyId) resolvedConfirmationKeys.current.add(item.key)
      }
      for (const item of historyConfirmationsRef.current) {
        if (item.replyId === replyId) resolvedConfirmationKeys.current.add(item.key)
      }
      setConfirmationRequests((current) => current.filter((item) => item.replyId !== replyId))
    }

    const registerExternalRequests = (replyId: string, calls: PendingToolCall[]) => {
      const validCalls = calls.filter((call) => call && typeof call.id === 'string' && typeof call.name === 'string' && typeof call.input === 'string')
      setExternalRequests((current) => {
        const next = [...current]
        for (const call of validCalls) {
          const key = `${replyId}:${call.id}`
          if (resolvedExternalKeys.current.has(key) || next.some((item) => item.key === key)) continue
          next.push({ key, replyId, toolCall: call, status: 'pending', output: '' })
        }
        return next
      })
      setToolEvents((current) => {
        let next = current
        for (const call of validCalls) {
          next = ensureToolExecution(next, call.id, replyId, call.name).map((item) => item.id === call.id ? {
            ...item, replyId, name: call.name, state: 'awaiting_external_result', argumentsSummary: summarizeToolArguments(call.input),
          } : item)
        }
        return next
      })
    }

    const resolveExternalForReply = (replyId: string) => {
      for (const item of externalRequestsRef.current) if (item.replyId === replyId) resolvedExternalKeys.current.add(item.key)
      for (const item of historyExternalRequestsRef.current) if (item.replyId === replyId) resolvedExternalKeys.current.add(item.key)
      setExternalRequests((current) => current.filter((item) => item.replyId !== replyId))
    }

    const consumeEvent = (payload: string) => {
      if (controller.signal.aborted || generation !== streamGeneration.current) return
      let event: StreamEvent
      try {
        const parsed = JSON.parse(payload) as StreamEvent
        if (parsed && typeof parsed === 'object' && 'payload' in parsed && parsed.payload) {
          event = typeof parsed.payload === 'string' ? JSON.parse(parsed.payload) as StreamEvent : parsed.payload
        } else {
          event = parsed
        }
      } catch { return }
      if (!event || typeof event.type !== 'string') return
      const eventKey = event.id
        ? `id:${event.id}`
        : typeof (event.sequence ?? event.seq) === 'number'
          ? `seq:${event.reply_id ?? ''}:${event.sequence ?? event.seq}`
          : undefined
      if (eventKey && seenEventIds.current.has(eventKey)) return
      if (eventKey) {
        seenEventIds.current.add(eventKey)
        // The server replays up to 1000 recent events on reconnect.
        if (seenEventIds.current.size > 5000) {
          const oldest = seenEventIds.current.values().next().value
          if (oldest) seenEventIds.current.delete(oldest)
        }
      }
      if (event.type === 'REPLY_START') {
        void client.refetchQueries({ queryKey: sessionListKey, type: 'active' })
      }
      if (event.type === 'CUSTOM' && event.name === 'subagent_require_user_confirm') {
        const projected = event.value?.event
        const replyId = projected?.reply_id ?? event.value?.reply_id
        const calls = projected?.tool_calls ?? []
        if (replyId && event.value?.event_type === 'require_external_execution') registerExternalRequests(replyId, calls)
        else if (replyId) registerConfirmationRequests(replyId, calls)
        return
      }
      if (event.type === 'CUSTOM' && event.name === 'subagent_user_confirm_result') {
        if (event.value?.reply_id) {
          resolveConfirmationsForReply(event.value.reply_id)
          resolveExternalForReply(event.value.reply_id)
          setSending(true)
          void client.invalidateQueries({ queryKey: [...messagesKey, 'status'] })
          void client.invalidateQueries({ queryKey: messagesKey })
          void client.invalidateQueries({ queryKey: sessionListKey })
        }
        return
      }
      if (event.type === 'REQUIRE_USER_CONFIRM' && event.reply_id) {
        registerConfirmationRequests(event.reply_id, event.tool_calls ?? [])
        return
      }
      if (event.type === 'REQUIRE_EXTERNAL_EXECUTION' && event.reply_id) {
        registerExternalRequests(event.reply_id, event.tool_calls ?? [])
        return
      }
      if (event.type === 'EXTERNAL_EXECUTION_RESULT' && event.reply_id) {
        for (const result of event.execution_results ?? []) resolvedExternalKeys.current.add(`${event.reply_id}:${result.id}`)
        setExternalRequests((current) => current.filter((item) => !resolvedExternalKeys.current.has(item.key)))
        setSending(true)
        void client.invalidateQueries({ queryKey: [...messagesKey, 'status'] })
        void client.invalidateQueries({ queryKey: messagesKey })
        void client.invalidateQueries({ queryKey: sessionListKey })
        return
      }
      if (event.type === 'USER_CONFIRM_RESULT' && event.reply_id) {
        for (const result of event.confirm_results ?? []) {
          const key = `${event.reply_id}:${result.tool_call.id}`
          resolvedConfirmationKeys.current.add(key)
        }
        setConfirmationRequests((current) => current.filter((item) => !resolvedConfirmationKeys.current.has(item.key)))
        setSending(true)
        void client.invalidateQueries({ queryKey: [...messagesKey, 'status'] })
        void client.invalidateQueries({ queryKey: messagesKey })
        void client.invalidateQueries({ queryKey: sessionListKey })
        return
      }
      const replyId = event.reply_id
      if (!replyId) return
      if (event.type === 'REPLY_START') {
        setLiveReplies((current) => current.some((reply) => reply.id === replyId)
          ? current
          : [...current, { id: replyId, name: event.name || '智能体', blocks: [] }])
      } else if (event.type === 'TEXT_BLOCK_START' && event.block_id) {
        const blockId = event.block_id
        setLiveReplies((current) => {
          const replies = ensureLiveReply(current, replyId)
          return replies.map((reply) => reply.id !== replyId || reply.blocks.some((block) => block.id === blockId)
            ? reply
            : { ...reply, blocks: [...reply.blocks, { id: blockId, text: '' }] })
        })
      } else if (event.type === 'TEXT_BLOCK_DELTA' && event.block_id && typeof event.delta === 'string') {
        const blockId = event.block_id
        const delta = event.delta
        setLiveReplies((current) => {
          const replies = ensureLiveReply(current, replyId)
          return replies.map((reply) => reply.id !== replyId ? reply : {
            ...reply,
            blocks: reply.blocks.some((block) => block.id === blockId)
              ? reply.blocks.map((block) => block.id === blockId ? { ...block, text: block.text + delta } : block)
              : [...reply.blocks, { id: blockId, text: delta }],
          })
        })
      } else if (event.type === 'TEXT_BLOCK_END' && event.block_id && typeof event.text === 'string') {
        const blockId = event.block_id
        const finalText = event.text
        setLiveReplies((current) => current.map((reply) => reply.id !== replyId ? reply : {
          ...reply,
          blocks: reply.blocks.map((block) => block.id === blockId ? { ...block, text: finalText } : block),
        }))
      } else if (event.type === 'TOOL_CALL_START' && event.tool_call_id) {
        const toolId = event.tool_call_id
        const name = event.tool_call_name || '工具'
        toolCallBuffers.current.set(toolId, '')
        setToolEvents((current) => {
          const items = ensureToolExecution(current, toolId, replyId, name)
          return items.map((item) => item.id === toolId ? { ...item, replyId, name, state: 'requesting', startedAt: event.created_at ?? item.startedAt } : item)
        })
      } else if (event.type === 'TOOL_CALL_DELTA' && event.tool_call_id && typeof event.delta === 'string') {
        const previous = toolCallBuffers.current.get(event.tool_call_id) ?? ''
        toolCallBuffers.current.set(event.tool_call_id, (previous + event.delta).slice(0, MAX_TOOL_ARGUMENTS_CHARS * 10))
      } else if (event.type === 'TOOL_CALL_END' && event.tool_call_id) {
        const toolId = event.tool_call_id
        const rawArguments = toolCallBuffers.current.get(toolId) ?? ''
        toolCallBuffers.current.delete(toolId)
        setToolEvents((current) => {
          const items = ensureToolExecution(current, toolId, replyId, event.tool_call_name || '工具')
          return items.map((item) => item.id === toolId ? {
            ...item,
            state: 'requesting',
            ...(rawArguments ? { argumentsSummary: summarizeToolArguments(rawArguments) } : {}),
          } : item)
        })
      } else if (event.type === 'TOOL_RESULT_START' && event.tool_call_id) {
        const toolId = event.tool_call_id
        setToolEvents((current) => {
          const items = ensureToolExecution(current, toolId, replyId, event.tool_call_name || '工具')
          return items.map((item) => item.id === toolId ? {
            ...item, replyId, name: event.tool_call_name || item.name, state: 'running', startedAt: event.created_at ?? item.startedAt, resultText: '', resultTruncated: false,
          } : item)
        })
      } else if (event.type === 'TOOL_RESULT_TEXT_DELTA' && event.tool_call_id && typeof event.delta === 'string') {
        const toolId = event.tool_call_id
        const delta = event.delta
        setToolEvents((current) => current.map((item) => item.id !== toolId ? item : {
          ...item,
          resultText: `${item.resultText ?? ''}${delta}`.slice(0, MAX_TOOL_RESULT_CHARS + 1),
          resultTruncated: `${item.resultText ?? ''}${delta}`.length > MAX_TOOL_RESULT_CHARS,
        }))
      } else if (event.type === 'TOOL_RESULT_DATA_DELTA' && event.tool_call_id) {
        const toolId = event.tool_call_id
        setToolEvents((current) => current.map((item) => {
          if (item.id !== toolId) return item
          const resultText = item.resultText ? `${item.resultText}\n[已隐藏附件或二进制结果]` : '[已隐藏附件或二进制结果]'
          return { ...item, resultText: resultText.slice(0, MAX_TOOL_RESULT_CHARS + 1), resultTruncated: item.resultTruncated || resultText.length > MAX_TOOL_RESULT_CHARS }
        }))
      } else if (event.type === 'TOOL_RESULT_END' && event.tool_call_id) {
        const toolId = event.tool_call_id
        const state = ['success', 'error', 'interrupted', 'denied'].includes(event.state ?? '')
          ? event.state as ToolExecution['state']
          : 'finished'
        setToolEvents((current) => {
          const items = ensureToolExecution(current, toolId, replyId, event.tool_call_name || '工具')
          return items.map((item) => item.id !== toolId ? item : {
            ...item, state, finishedAt: event.created_at ?? item.finishedAt, resultText: item.resultText ? redactToolText(item.resultText) : item.resultText,
          })
        })
      } else if (event.type === 'REPLY_END') {
        resolveConfirmationsForReply(replyId)
        resolveExternalForReply(replyId)
        void client.invalidateQueries({ queryKey: messagesKey })
        void client.invalidateQueries({ queryKey: sessionListKey })
      }
    }

    const parseFrames = () => {
      let boundary: number
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '')
        const data = frame.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n')
        if (data) consumeEvent(data)
      }
    }

    const connect = async () => {
      setStreamError('')
      setStreamConnected(false)
      const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '')
      let response: Response
      try {
        response = await fetch(`${apiBase}${aiPath}/sessions/${encodeURIComponent(sessionId)}/stream?agent_id=${encodeURIComponent(agentId)}`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            'X-Workspace-ID': workspace.workspace_id,
          },
          credentials: 'include',
          signal: controller.signal,
        })
      } catch (error) {
        if (!controller.signal.aborted) setStreamError(error instanceof Error ? error.message : '消息流连接失败。')
        return
      }
      if (controller.signal.aborted || generation !== streamGeneration.current) return
      if (!response.ok || !response.body) {
        if (response.status === 401) useAuthStore.getState().auth.reset()
        if ([401, 403, 404, 409].includes(response.status)) {
          setAccessDenied(true)
          setText('')
          setSelectedAttachments([])
          setLiveReplies([])
          setToolEvents([])
          setConfirmationRequests([])
          setExternalRequests([])
          confirmationInFlight.current.clear()
          externalInFlight.current.clear()
          toolCallBuffers.current.clear()
          void client.removeQueries({ queryKey: messagesKey, exact: true })
          void client.removeQueries({ queryKey: attachmentKey, exact: true })
        }
        setStreamError(`消息流连接失败（HTTP ${response.status}），可重试。`)
        return
      }

      setStreamConnected(true)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      try {
        while (!controller.signal.aborted && generation === streamGeneration.current) {
          const { value, done } = await reader.read()
          if (done) {
            buffer += decoder.decode()
            parseFrames()
            break
          }
          buffer += decoder.decode(value, { stream: true })
          parseFrames()
        }
        if (!controller.signal.aborted && generation === streamGeneration.current) {
          setStreamConnected(false)
          setStreamError('消息流已断开，已收到的文本保留。可重试以接收后续内容。')
        }
      } catch (error) {
        if (!controller.signal.aborted && generation === streamGeneration.current) {
          setStreamConnected(false)
          setStreamError(error instanceof Error ? error.message : '消息流中断，已收到的文本保留。可重试。')
        }
      } finally {
        try { await reader.cancel() } catch { /* reader may already be closed */ }
      }
    }

    void connect()
    return () => {
      controller.abort()
      if (streamController.current === controller) streamController.current = null
    }
  }, [agentId, attachmentKey, client, messagesKey, sessionId, sessionListKey, streamRetry, workspace.workspace_id])

  React.useEffect(() => {
    if (interruptPending || !(sending || stopRequested) || runStatus.isLoading || runStatus.isFetching) return
    if (runStatus.isError) {
      setSending(false)
      setStopRequested(false)
      setSendError(formatError(runStatus.error))
      if (runStatus.error instanceof ApiProblem && [401, 403, 404, 409].includes(runStatus.error.status)) {
        setAccessDenied(true)
        setText('')
        setSelectedAttachments([])
        setLiveReplies([])
        setToolEvents([])
        setConfirmationRequests([])
        setExternalRequests([])
        confirmationInFlight.current.clear()
        externalInFlight.current.clear()
        toolCallBuffers.current.clear()
        void client.removeQueries({ queryKey: messagesKey, exact: true })
        void client.removeQueries({ queryKey: attachmentKey, exact: true })
      }
      return
    }
    if (runStatus.data && runStatus.data.status !== 'running') {
      setSending(false)
      setStopRequested(false)
      void client.invalidateQueries({ queryKey: messagesKey })
      void client.invalidateQueries({ queryKey: sessionListKey })
    }
  }, [attachmentKey, client, interruptPending, messagesKey, runStatus.data, runStatus.error, runStatus.isError, runStatus.isFetching, runStatus.isLoading, sending, sessionListKey, stopRequested])

  React.useEffect(() => () => {
    sendController.current?.abort()
    streamController.current?.abort()
    for (const controller of confirmationControllers.current.values()) controller.abort()
    confirmationControllers.current.clear()
    for (const controller of externalControllers.current.values()) controller.abort()
    externalControllers.current.clear()
    // Messages and attachment metadata are scoped to this exact actor and
    // Workspace. Drop their cached copies when the session panel leaves view.
    void client.removeQueries({ queryKey: messagesKey, exact: true })
    void client.removeQueries({ queryKey: attachmentKey, exact: true })
  }, [client, messagesKey, attachmentKey])

  const send = async () => {
    const contentText = text.trim()
    if ((!contentText && pickedAttachments.length === 0) || sending || submitting || pickedBytes > MAX_CHAT_ATTACHMENT_BYTES) return
    setSendError('')
    setAccessDenied(false)
    setSubmitting(true)
    const controller = new AbortController()
    sendController.current = controller
    try {
      const blocks: Array<{ type: 'text'; text: string } | DataBlock> = []
      if (contentText) blocks.push({ type: 'text', text: contentText })
      for (const attachment of pickedAttachments) {
        const blob = await downloadAttachment(
          workspace.workspace_id,
          attachment.attachment_id,
          'workspace',
          { headers, signal: controller.signal },
        )
        blocks.push({
          type: 'data', name: attachment.filename,
          source: { type: 'base64', data: await blobToBase64(blob), media_type: attachment.media_type || blob.type || 'application/octet-stream' },
        })
      }
      await api<{ status: string; session_id: string }>(`${aiPath}/chat/`, {
        method: 'POST', headers, signal: controller.signal,
        body: JSON.stringify({ agent_id: agentId, session_id: sessionId, input: { role: 'user', name: 'user', content: blocks } }),
      })
      // Clear the composer only after the server confirms that the run was
      // accepted. A failed POST leaves the user's text and attachments intact.
      setText('')
      setSelectedAttachments([])
      setSending(true)
      setSendError('')
      void client.invalidateQueries({ queryKey: [...messagesKey, 'status'] })
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setSendError(formatError(error))
        if (error instanceof ApiProblem && [401, 403, 404].includes(error.status)) {
          setAccessDenied(true)
          setText('')
          setSelectedAttachments([])
          setLiveReplies([])
          setToolEvents([])
          setConfirmationRequests([])
          setExternalRequests([])
          confirmationInFlight.current.clear()
          externalInFlight.current.clear()
          toolCallBuffers.current.clear()
          void client.removeQueries({ queryKey: messagesKey, exact: true })
          void client.removeQueries({ queryKey: attachmentKey, exact: true })
        }
      }
    } finally {
      if (sendController.current === controller) sendController.current = null
      setSubmitting(false)
    }
  }

  const submitConfirmation = async (request: PendingConfirmation, confirmed: boolean) => {
    if (request.status !== 'pending' || confirmationInFlight.current.has(request.key) || accessDenied) return
    confirmationInFlight.current.add(request.key)
    const controller = new AbortController()
    confirmationControllers.current.set(request.key, controller)
    setConfirmationRequests((current) => current.map((item) => item.key === request.key ? { ...item, status: 'submitting', error: undefined } : item))
    setSendError('')
    try {
      await api<{ status: string; session_id: string }>(`${aiPath}/chat/`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          agent_id: agentId,
          session_id: sessionId,
          input: {
            type: 'USER_CONFIRM_RESULT',
            reply_id: request.replyId,
            confirm_results: [{ confirmed, tool_call: request.toolCall }],
          },
        }),
      })
      if (controller.signal.aborted) return
      resolvedConfirmationKeys.current.add(request.key)
      setConfirmationRequests((current) => current.filter((item) => item.key !== request.key))
      setSending(true)
      setSendError('')
      void client.invalidateQueries({ queryKey: [...messagesKey, 'status'] })
      void client.invalidateQueries({ queryKey: messagesKey })
      void client.invalidateQueries({ queryKey: sessionListKey })
    } catch (error) {
      if (controller.signal.aborted) return
      const expired = error instanceof ApiProblem && [404, 409].includes(error.status)
      setConfirmationRequests((current) => current.map((item) => item.key === request.key ? {
        ...item,
        status: expired ? 'stale' : 'pending',
        error: expired ? '确认请求已过期或已被处理，正在刷新当前状态。' : formatError(error),
      } : item))
      if (error instanceof ApiProblem && [401, 403].includes(error.status)) {
        if (error.status === 401) useAuthStore.getState().auth.reset()
        setAccessDenied(true)
        setText('')
        setSelectedAttachments([])
        setLiveReplies([])
        setToolEvents([])
        setConfirmationRequests([])
        setExternalRequests([])
        confirmationInFlight.current.clear()
        externalInFlight.current.clear()
        toolCallBuffers.current.clear()
        for (const item of historyConfirmationsRef.current) resolvedConfirmationKeys.current.add(item.key)
        void client.removeQueries({ queryKey: messagesKey, exact: true })
        void client.removeQueries({ queryKey: attachmentKey, exact: true })
      } else {
        setSendError(expired ? '确认请求已失效，消息与运行状态已刷新。' : `提交确认失败：${formatError(error)}`)
      }
      void client.invalidateQueries({ queryKey: [...messagesKey, 'status'] })
      void client.invalidateQueries({ queryKey: messagesKey })
      void client.invalidateQueries({ queryKey: sessionListKey })
    } finally {
      confirmationInFlight.current.delete(request.key)
      if (confirmationControllers.current.get(request.key) === controller) {
        confirmationControllers.current.delete(request.key)
      }
    }
  }

  const submitExternalResult = async (request: PendingExternalResult, cancel = false) => {
    if (request.status !== 'pending' || externalInFlight.current.has(request.key) || accessDenied) return
    const output = cancel ? '外部任务已由用户取消。' : redactToolText(request.output.trim()).slice(0, MAX_EXTERNAL_RESULT_CHARS)
    if (!cancel && !output) {
      setExternalRequests((current) => {
        const existing = current.find((item) => item.key === request.key)
        if (existing) return current.map((item) => item.key === request.key ? { ...item, error: '请填写外部任务结果。' } : item)
        return [...current, { ...request, error: '请填写外部任务结果。' }]
      })
      return
    }
    externalInFlight.current.add(request.key)
    const controller = new AbortController()
    externalControllers.current.set(request.key, controller)
    setExternalRequests((current) => {
      const existing = current.find((item) => item.key === request.key)
      if (existing) return current.map((item) => item.key === request.key ? { ...item, status: 'submitting', error: undefined } : item)
      return [...current, { ...request, status: 'submitting', error: undefined }]
    })
    setSendError('')
    try {
      await api<{ status: string; session_id: string }>(`${aiPath}/chat/`, {
        method: 'POST', headers, signal: controller.signal,
        body: JSON.stringify({
          agent_id: agentId,
          session_id: sessionId,
          input: {
            type: 'EXTERNAL_EXECUTION_RESULT',
            reply_id: request.replyId,
            execution_results: [{
              type: 'tool_result',
              id: request.toolCall.id,
              name: request.toolCall.name,
              output,
              state: cancel ? 'interrupted' : 'success',
            }],
          },
        }),
      })
      resolvedExternalKeys.current.add(request.key)
      setExternalRequests((current) => current.filter((item) => item.key !== request.key))
      setSending(true)
      setSendError('')
      void client.invalidateQueries({ queryKey: [...messagesKey, 'status'] })
      void client.invalidateQueries({ queryKey: messagesKey })
      void client.invalidateQueries({ queryKey: sessionListKey })
    } catch (error) {
      const expired = error instanceof ApiProblem && [404, 409].includes(error.status)
      setExternalRequests((current) => {
        const existing = current.find((item) => item.key === request.key)
        const next = {
          ...(existing ?? request),
          status: expired ? 'stale' as const : 'pending' as const,
          error: expired ? '外部任务请求已过期或已被处理，正在刷新当前状态。' : formatError(error),
        }
        return existing
          ? current.map((item) => item.key === request.key ? next : item)
          : [...current, next]
      })
      if (error instanceof ApiProblem && [401, 403].includes(error.status)) {
        if (error.status === 401) useAuthStore.getState().auth.reset()
        setAccessDenied(true)
        setText('')
        setSelectedAttachments([])
        setLiveReplies([])
        setToolEvents([])
        setConfirmationRequests([])
        setExternalRequests([])
        confirmationInFlight.current.clear()
        externalInFlight.current.clear()
        toolCallBuffers.current.clear()
        void client.removeQueries({ queryKey: messagesKey, exact: true })
        void client.removeQueries({ queryKey: attachmentKey, exact: true })
      } else {
        setSendError(expired ? '外部任务请求已失效，消息与运行状态已刷新。' : `提交外部结果失败：${formatError(error)}`)
      }
      void client.invalidateQueries({ queryKey: [...messagesKey, 'status'] })
      void client.invalidateQueries({ queryKey: messagesKey })
      void client.invalidateQueries({ queryKey: sessionListKey })
    } finally {
      externalInFlight.current.delete(request.key)
      if (externalControllers.current.get(request.key) === controller) externalControllers.current.delete(request.key)
    }
  }

  const interrupt = async () => {
    const interruptible = sending || initiallyRunning
      || initialStatus === 'awaiting_permission'
      || initialStatus === 'awaiting_external_result'
      || runStatus.data?.status === 'running'
      || runStatus.data?.status === 'awaiting_permission'
      || runStatus.data?.status === 'awaiting_external_result'
    if (interruptInFlight.current || !interruptible) return
    const wasRunning = sending || initiallyRunning || runStatus.data?.status === 'running'
    interruptInFlight.current = true
    setInterruptPending(true)
    setSendError('')
    setSending(true)
    try {
      await api<{ session_id: string }>(`${aiPath}/sessions/${encodeURIComponent(sessionId)}/interrupt?agent_id=${encodeURIComponent(agentId)}`, {
        method: 'POST', headers,
      })
      setStopRequested(true)
      void client.invalidateQueries({ queryKey: [...messagesKey, 'status'] })
      void client.invalidateQueries({ queryKey: messagesKey })
      void client.invalidateQueries({ queryKey: sessionListKey })
    } catch (error) {
      setSending(wasRunning)
      setStopRequested(false)
      setSendError(`中断失败：${formatError(error)}`)
      if (error instanceof ApiProblem && [401, 403, 404, 409].includes(error.status)) {
        setAccessDenied(true)
        setText('')
        setSelectedAttachments([])
        setLiveReplies([])
        setToolEvents([])
        setConfirmationRequests([])
        setExternalRequests([])
        confirmationInFlight.current.clear()
        externalInFlight.current.clear()
        toolCallBuffers.current.clear()
        void client.removeQueries({ queryKey: messagesKey, exact: true })
        void client.removeQueries({ queryKey: attachmentKey, exact: true })
      } else {
        void client.invalidateQueries({ queryKey: [...messagesKey, 'status'] })
        void client.invalidateQueries({ queryKey: sessionListKey })
      }
    } finally {
      interruptInFlight.current = false
      setInterruptPending(false)
    }
  }

  const toggleAttachment = (id: string) => setSelectedAttachments((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const historyError = history.isError ? formatError(history.error) : ''
  const historyAccessDenied = history.isError && history.error instanceof ApiProblem && [401, 403, 404, 409].includes(history.error.status)

  return (
    <Card>
      <CardHeader><CardTitle><LocalizedText text={"消息"} /></CardTitle><CardDescription>{sessionName} <LocalizedText text={" · 文本与 Workspace 附件"} /></CardDescription></CardHeader>
      <CardContent className='space-y-4'>
        {(sendError || historyError || attachments.isError) && <Alert variant='destructive'><AlertDescription>{sendError || historyError || formatError(attachments.error)}</AlertDescription></Alert>}
        {accessDenied || historyAccessDenied ? <p role='alert' className='py-10 text-center text-sm text-destructive'><LocalizedText text={"当前会话已不可访问，消息内容已清除。"} /></p> : <>
          {history.data?.pages[0]?.has_more && <Button type='button' variant='outline' size='sm' disabled={history.isFetchingPreviousPage} onClick={() => void history.fetchPreviousPage()}>{history.isFetchingPreviousPage ? <LocalizedText text={"正在加载…"} /> : <LocalizedText text={"加载更早消息"} />}</Button>}
          <div className='max-h-[55vh] min-h-64 space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-4'>
            {history.isLoading ? <p className='py-10 text-center text-sm text-muted-foreground'><LocalizedText text={"正在加载消息…"} /></p> : allMessages.length ? allMessages.map((message) => <MessageBubble key={message.id} message={message} />) : !history.isError && <p className='py-10 text-center text-sm text-muted-foreground'><LocalizedText text={"还没有消息。发送第一条消息开始对话。"} /></p>}
            {visibleLiveReplies.map((reply) => <article key={reply.id} className='mr-auto max-w-[90%] rounded-xl border bg-card p-3'><header className='mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground'><span>{reply.name}</span><span className='flex items-center gap-1'><Loader2 className='size-3 animate-spin' /><LocalizedText text={"实时回复"} /></span></header><div className='space-y-2 text-sm'>{reply.blocks.map((block) => <p key={block.id} className='whitespace-pre-wrap break-words'>{block.text}</p>)}</div></article>)}
            {sending && <div className='flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='size-4 animate-spin' /><LocalizedText text={"正在生成回复…"} /></div>}
          </div>
          {activeConfirmations.length > 0 && <section aria-label={t('工具权限确认')} className='space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4'><div><h3 className='font-medium'><LocalizedText text={"需要确认工具操作"} /></h3><p className='mt-1 text-sm text-muted-foreground'><LocalizedText text={"请检查工具名称和参数摘要。允许后该工具会继续执行；工具可能读取、修改数据或访问外部系统。"} /></p></div>{activeConfirmations.map((request) => {
            const busy = request.status === 'submitting' || confirmationInFlight.current.has(request.key)
            const disabled = busy || request.status === 'stale' || accessDenied
            return <article key={request.key} className='space-y-3 rounded-md border bg-background p-3'>
              <div className='flex flex-wrap items-center justify-between gap-2'><span className='font-medium'>{request.toolCall.name}</span><span className='text-xs text-muted-foreground'>{request.status === 'stale' ? <LocalizedText text={"请求已失效"} /> : busy ? <LocalizedText text={"正在提交…"} /> : <LocalizedText text={"等待你的决定"} />}</span></div>
              <DetailDialog trigger={<LocalizedText text={"查看脱敏参数摘要"} />} title={<LocalizedText text={"脱敏参数摘要"} />} description={request.toolCall.name} triggerClassName='h-auto px-0 py-0 text-xs text-muted-foreground underline' contentClassName='sm:max-w-2xl'><pre className='max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-xs'>{summarizeToolArguments(request.toolCall.input)}</pre></DetailDialog>
              {request.error && <p role='alert' className={`text-sm ${request.status === 'stale' ? 'text-muted-foreground' : 'text-destructive'}`}>{request.error}</p>}
              <div className='flex justify-end gap-2'>{request.status === 'stale' ? <Button type='button' size='sm' variant='outline' onClick={() => { resolvedConfirmationKeys.current.add(request.key); setConfirmationRequests((current) => current.filter((item) => item.key !== request.key)) }}><LocalizedText text={"关闭"} /></Button> : <><Button type='button' size='sm' variant='outline' disabled={disabled} onClick={() => void submitConfirmation(request, false)}><LocalizedText text={"拒绝"} /></Button><Button type='button' size='sm' variant='destructive' disabled={disabled} onClick={() => void submitConfirmation(request, true)}>{busy ? <Loader2 className='mr-2 size-3.5 animate-spin' /> : null}<LocalizedText text={"允许并继续"} /></Button></>}</div>
            </article>
          })}</section>}
          {activeExternalRequests.length > 0 && <section aria-label={t('外部任务结果')} className='space-y-3 rounded-lg border border-sky-500/40 bg-sky-500/5 p-4'><div><h3 className='font-medium'><LocalizedText text={"等待提交外部任务结果"} /></h3><p className='mt-1 text-sm text-muted-foreground'><LocalizedText text={"这些任务需要由外部执行器处理。请只提交任务结果；不要输入密码、访问令牌、密钥或其他凭据。提交内容会保存到当前会话。"} /></p></div>{activeExternalRequests.map((request) => {
            const busy = request.status === 'submitting' || externalInFlight.current.has(request.key)
            const disabled = busy || request.status === 'stale' || accessDenied
            return <article key={request.key} className='space-y-3 rounded-md border bg-background p-3'>
              <div className='flex flex-wrap items-center justify-between gap-2'><span className='font-medium'>{request.toolCall.name}</span><span className='text-xs text-muted-foreground'>{request.status === 'stale' ? <LocalizedText text={"请求已失效"} /> : busy ? <LocalizedText text={"正在提交…"} /> : <LocalizedText text={"等待外部结果"} />}</span></div>
              <DetailDialog trigger={<LocalizedText text={"查看脱敏任务参数摘要"} />} title={<LocalizedText text={"脱敏任务参数摘要"} />} description={request.toolCall.name} triggerClassName='h-auto px-0 py-0 text-xs text-muted-foreground underline' contentClassName='sm:max-w-2xl'><pre className='max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-xs'>{summarizeToolArguments(request.toolCall.input)}</pre></DetailDialog>
              {request.status !== 'stale' && <div className='space-y-2'><Label htmlFor={`external-result-${request.key}`}><LocalizedText text={"外部任务说明 / 结果"} /></Label><Textarea id={`external-result-${request.key}`} maxLength={MAX_EXTERNAL_RESULT_CHARS} className='min-h-24 resize-y' value={request.output} disabled={disabled} placeholder='填写外部执行器返回的文本结果…' onChange={(event) => setExternalRequests((current) => {
                const existing = current.find((item) => item.key === request.key)
                if (existing) return current.map((item) => item.key === request.key ? { ...item, output: event.target.value, error: undefined } : item)
                return [...current, { ...request, output: event.target.value, error: undefined }]
              })} /><p className='text-xs text-muted-foreground'><LocalizedText text={"最多 "} />{MAX_EXTERNAL_RESULT_CHARS} <LocalizedText text={" 个字符。常见凭据格式会在发送前脱敏。"} /></p></div>}
              {request.error && <p role='alert' className={`text-sm ${request.status === 'stale' ? 'text-muted-foreground' : 'text-destructive'}`}>{request.error}</p>}
              <div className='flex justify-end gap-2'>{request.status === 'stale' ? <Button type='button' size='sm' variant='outline' onClick={() => { resolvedExternalKeys.current.add(request.key); setExternalRequests((current) => current.filter((item) => item.key !== request.key)) }}><LocalizedText text={"关闭"} /></Button> : <><Button type='button' size='sm' variant='outline' disabled={disabled} onClick={() => void submitExternalResult(request, true)}><LocalizedText text={"取消外部任务"} /></Button><Button type='button' size='sm' disabled={disabled || !request.output.trim()} onClick={() => void submitExternalResult(request)}>{busy ? <Loader2 className='mr-2 size-3.5 animate-spin' /> : null}<LocalizedText text={"提交结果"} /></Button></>}</div>
            </article>
          })}</section>}
          {toolTimeline.length > 0 && <section aria-label={t('工具执行时间线')} className='space-y-2 rounded-lg border p-3'><h3 className='text-sm font-medium'><LocalizedText text={"工具执行"} /></h3>{toolTimeline.map((tool) => {
            const result = tool.resultText ? redactToolText(tool.resultText) : ''
            return <article key={tool.id} className='space-y-2 rounded-md border bg-card p-3'>
              <header className='flex flex-wrap items-center justify-between gap-2 text-sm'><span className='font-medium'>{tool.name}</span><div className='flex items-center gap-2'><span className='text-xs text-muted-foreground'>{tool.startedAt && `开始 ${formatTimelineTime(tool.startedAt)}`}{tool.finishedAt && ` · 结束 ${formatTimelineTime(tool.finishedAt)}`}</span><span className={`rounded-full px-2 py-0.5 text-xs ${tool.state === 'error' ? 'bg-destructive/10 text-destructive' : tool.state === 'success' ? 'bg-primary/10 text-primary' : tool.state === 'awaiting_confirmation' || tool.state === 'awaiting_external_result' ? 'bg-amber-500/10 text-amber-700' : 'bg-muted text-muted-foreground'}`}>{toolStateLabel(tool.state)}</span></div></header>
              {tool.state === 'error' && <p className='text-sm text-destructive'>{result ? `${result.slice(0, 240)}${result.length > 240 ? '…' : ''}` : <LocalizedText text={"工具执行失败，服务端未返回可显示的错误详情。"} />}</p>}
              {tool.argumentsSummary && <DetailDialog trigger={<LocalizedText text={"查看脱敏参数摘要"} />} title={<LocalizedText text={"脱敏参数摘要"} />} description={tool.name} triggerClassName='h-auto px-0 py-0 text-xs text-muted-foreground underline' contentClassName='sm:max-w-2xl'><pre className='max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-xs'>{tool.argumentsSummary}</pre></DetailDialog>}
              {result && ['success', 'error', 'interrupted', 'denied', 'finished'].includes(tool.state) && <DetailDialog trigger={<LocalizedText text={tool.resultTruncated ? '查看脱敏工具结果（已截断）' : '查看脱敏工具结果'} />} title={<LocalizedText text={"脱敏工具结果"} />} description={tool.name} triggerClassName='h-auto px-0 py-0 text-xs text-muted-foreground underline' contentClassName='sm:max-w-2xl'><pre className='max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-xs'>{result}{tool.resultTruncated ? <LocalizedText text={"\n…结果过长，已截断"} /> : <LocalizedText text={""} />}</pre></DetailDialog>}
            </article>
          })}</section>}
          {streamError && <div className='flex flex-wrap items-center justify-between gap-2 text-sm text-destructive'><span>{streamError}</span><Button type='button' size='sm' variant='outline' onClick={() => setStreamRetry((value) => value + 1)}><LocalizedText text={"重试消息流"} /></Button></div>}
          <div className='space-y-3 rounded-lg border p-3'>
            <Textarea aria-label={t('输入消息')} placeholder='输入消息…' className='min-h-24 resize-y border-0 shadow-none focus-visible:ring-0' value={text} disabled={sending || submitting || accessDenied} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} />
            <div className='flex flex-wrap items-center justify-between gap-3 border-t pt-3'>
              <div className='min-w-0 flex-1'>
                <DetailDialog
                  trigger={<><Paperclip className='size-4' /><LocalizedText text={"引用 Workspace 附件"} />{selectedAttachments.length ? `（${selectedAttachments.length}）` : <LocalizedText text={""} />}</>}
                  title={<LocalizedText text={"引用 Workspace 附件"} />}
                  description='选中的文件内容会作为消息附件发送，合计上限 5 MiB。'
                  triggerClassName='h-auto justify-start px-0 text-sm text-muted-foreground'
                  contentClassName='sm:max-w-xl'
                >
                  <div className='max-h-64 space-y-1 overflow-y-auto rounded border p-2'>
                    {attachments.isLoading ? <p className='text-xs text-muted-foreground'><LocalizedText text={"正在加载附件…"} /></p> : attachments.data?.items.length ? attachments.data.items.map((attachment) => <label key={attachment.attachment_id} className='flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent'><Checkbox checked={selectedAttachments.includes(attachment.attachment_id)} disabled={sending || submitting || (!selectedAttachments.includes(attachment.attachment_id) && pickedBytes + attachment.size_bytes > MAX_CHAT_ATTACHMENT_BYTES)} onCheckedChange={() => toggleAttachment(attachment.attachment_id)} /><span className='min-w-0 flex-1 truncate'>{attachment.filename}</span><span className='shrink-0 text-muted-foreground'>{formatBytes(attachment.size_bytes)}</span></label>) : !attachments.isError && <p className='text-xs text-muted-foreground'><LocalizedText text={"当前 Workspace 没有可引用的附件。"} /></p>}
                  </div>
                </DetailDialog>
                {pickedBytes > MAX_CHAT_ATTACHMENT_BYTES && <p role='alert' className='mt-1 text-xs text-destructive'><LocalizedText text={"附件总大小超过 5 MiB。"} /></p>}
              </div>
              <div className='flex gap-2'>
                {(sending || initiallyRunning || initialStatus === 'awaiting_permission' || initialStatus === 'awaiting_external_result' || runStatus.data?.status === 'running' || runStatus.data?.status === 'awaiting_permission' || runStatus.data?.status === 'awaiting_external_result') && <Button type='button' size='sm' variant='destructive' disabled={interruptPending || accessDenied} onClick={() => void interrupt()}>{interruptPending ? <Loader2 className='mr-2 size-4 animate-spin' /> : <Square className='mr-2 size-3.5 fill-current' />}{interruptPending ? <LocalizedText text={"正在请求中断…"} /> : stopRequested ? <LocalizedText text={"等待停止…"} /> : <LocalizedText text={"中断生成"} />}</Button>}
                <Button type='button' disabled={sending || submitting || accessDenied || (!text.trim() && !pickedAttachments.length) || pickedBytes > MAX_CHAT_ATTACHMENT_BYTES} onClick={() => void send()}>{sending || submitting ? <Loader2 className='mr-2 size-4 animate-spin' /> : <Send className='mr-2 size-4' />}{submitting ? <LocalizedText text={"提交中…"} /> : sending ? <LocalizedText text={"生成中…"} /> : <LocalizedText text={"发送"} />}</Button>
              </div>
            </div>
          </div>
          <p className='text-xs text-muted-foreground'>{streamConnected ? <LocalizedText text={"实时消息流已连接。待确认工具请求仅作用于当前 Workspace 和会话。"} /> : <LocalizedText text={"正在连接实时消息流；已收到的助手文本和工具状态会保留，连接失败时可重试。"} />}</p>
        </>}
      </CardContent>
    </Card>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const user = message.role === 'user'
  const visibleBlocks = message.content.filter((block) => block.type === 'text' || block.type === 'data')
  return (
    <article className={`max-w-[90%] rounded-xl border p-3 ${user ? 'ml-auto bg-primary/5' : 'mr-auto bg-card'}`}>
      <header className='mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground'><span>{user ? <LocalizedText text={"我"} /> : message.role === 'assistant' ? <LocalizedText text={"智能体"} /> : <LocalizedText text={"系统"} />}</span><time>{message.created_at ? new Date(message.created_at).toLocaleString() : <LocalizedText text={""} />}</time></header>
      <div className='space-y-2 text-sm'>
        {visibleBlocks.map((block, index) => block.type === 'text' ? <p key={`${message.id}:${index}`} className='whitespace-pre-wrap break-words'>{block.text}</p> : <div key={`${message.id}:${index}`} className='rounded border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground'><Paperclip className='mr-1 inline size-3.5' />{block.name || block.source?.media_type || '附件'}</div>)}
        {!visibleBlocks.length && <p className='text-xs text-muted-foreground'><LocalizedText text={"此消息包含尚未支持展示的内容。"} /></p>}
      </div>
    </article>
  )
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
