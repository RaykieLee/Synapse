import * as React from 'react'
import { formatMessage } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bot, Pencil, Plus, Trash2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ApiProblem, api } from '@/lib/api'
import { useWorkspace } from './context'
import type { Workspace } from './types'
import { LocalizedText } from '@/components/localized-text'

type AgentData = {
  id: string
  name: string
  system_prompt: string
  context_config: Record<string, unknown>
  react_config: Record<string, unknown>
  invite_config: { invitable?: boolean; invite_description?: string | null }
}
type AgentView = {
  id: string
  user_id: string
  created_at?: string
  updated_at?: string
  data: AgentData
  editable: boolean
}
type AgentList = { agents: AgentView[]; total: number }
type AgentDraft = {
  name: string
  systemPrompt: string
  contextConfig: string
  reactConfig: string
  inviteConfig: string
}

const scopedKey = (actorId: string, workspace: Workspace, resource: string) =>
  ['synapse', actorId, workspace.tenant_id, workspace.workspace_id, resource, workspace.membership_version ?? 0] as const
const headers = (workspace: Workspace) => ({ 'X-Workspace-ID': workspace.workspace_id })
const aiPath = '/ai'

function toDraft(agent?: AgentView): AgentDraft {
  return {
    name: agent?.data.name ?? '',
    systemPrompt: agent?.data.system_prompt ?? "You're a helpful assistant.",
    contextConfig: JSON.stringify(agent?.data.context_config ?? {}, null, 2),
    reactConfig: JSON.stringify(agent?.data.react_config ?? {}, null, 2),
    inviteConfig: JSON.stringify(agent?.data.invite_config ?? { invitable: false, invite_description: null }, null, 2),
  }
}

function parseObject(value: string, field: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error(`${field} 必须是有效 JSON。`) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${field} 必须是 JSON 对象。`)
  return parsed as Record<string, unknown>
}

function formatError(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 403) return '当前 Workspace 成员没有此操作权限。'
    if (error.status === 404) return '智能体不存在，或已不属于当前 Workspace。'
    if (error.status === 409) return 'Workspace 状态或权限已变化，请刷新后重试。'
  }
  return error instanceof Error ? error.message : '操作失败，请重试。'
}

export function WorkspaceAgentsPage() {
  const { workspace, actorId } = useWorkspace()
  // Keying the page by scope drops selection, open dialogs and unsaved drafts
  // immediately when TanStack Router keeps this route mounted across a switch.
  return <WorkspaceAgentsContent key={`${actorId}:${workspace.tenant_id}:${workspace.workspace_id}`} workspace={workspace} actorId={actorId} />
}

function WorkspaceAgentsContent({ workspace, actorId }: { workspace: Workspace; actorId: string }) {
  const queryClient = useQueryClient()
  const scope = scopedKey(actorId, workspace, 'agent-list')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [editor, setEditor] = React.useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null)
  const [draft, setDraft] = React.useState<AgentDraft>(() => toDraft())
  const [formError, setFormError] = React.useState('')
  const canCreate = workspace.status === 'active'

  const agents = useQuery({
    queryKey: scope,
    queryFn: () => api<AgentList>(`${aiPath}/agent/`, { headers: headers(workspace) }),
  })
  const selectedIdInScope = selectedId && agents.data?.agents.some((agent) => agent.id === selectedId) ? selectedId : null
  const detail = useQuery({
    queryKey: [...scopedKey(actorId, workspace, 'agent-detail'), selectedIdInScope],
    queryFn: () => api<AgentView>(`${aiPath}/agent/${encodeURIComponent(selectedIdInScope!)}`, { headers: headers(workspace) }),
    enabled: Boolean(selectedIdInScope),
  })

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: scope })
    if (selectedIdInScope) await queryClient.invalidateQueries({ queryKey: [...scopedKey(actorId, workspace, 'agent-detail'), selectedIdInScope] })
  }
  const createAgent = useMutation({
    mutationFn: (value: AgentDraft) => api<{ agent_id: string }>(`${aiPath}/agent/`, {
      method: 'POST', headers: headers(workspace), body: JSON.stringify({
        name: value.name.trim(), system_prompt: value.systemPrompt,
        context_config: parseObject(value.contextConfig, '上下文配置'),
        react_config: parseObject(value.reactConfig, 'ReAct 配置'),
        invite_config: parseObject(value.inviteConfig, '邀请配置'),
      }),
    }),
    onSuccess: async (result) => {
      await refresh()
      setSelectedId(result.agent_id)
      setEditor(null)
      setFormError('')
    },
  })
  const updateAgent = useMutation({
    mutationFn: ({ id, value }: { id: string; value: AgentDraft }) => api<AgentView>(`${aiPath}/agent/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: headers(workspace), body: JSON.stringify({
        name: value.name.trim(), system_prompt: value.systemPrompt,
        context_config: parseObject(value.contextConfig, '上下文配置'),
        react_config: parseObject(value.reactConfig, 'ReAct 配置'),
        invite_config: parseObject(value.inviteConfig, '邀请配置'),
      }),
    }),
    onSuccess: async (result) => {
      await refresh()
      queryClient.setQueryData([...scopedKey(actorId, workspace, 'agent-detail'), result.id], result)
      setEditor(null)
      setFormError('')
    },
  })
  const deleteAgent = useMutation({
    mutationFn: (id: string) => api<void>(`${aiPath}/agent/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers(workspace) }),
    onSuccess: async (_, id) => {
      setSelectedId((current) => current === id ? null : current)
      await refresh()
    },
  })

  const openCreate = () => { createAgent.reset(); updateAgent.reset(); setDraft(toDraft()); setFormError(''); setEditor({ mode: 'create' }) }
  const openEdit = (agent: AgentView) => { createAgent.reset(); updateAgent.reset(); setDraft(toDraft(agent)); setFormError(''); setEditor({ mode: 'edit', id: agent.id }) }
  const submit = () => {
    setFormError('')
    if (!draft.name.trim()) { setFormError('请填写智能体名称。'); return }
    try {
      parseObject(draft.contextConfig, '上下文配置')
      parseObject(draft.reactConfig, 'ReAct 配置')
      parseObject(draft.inviteConfig, '邀请配置')
      if (editor?.mode === 'edit') updateAgent.mutate({ id: editor.id, value: draft })
      else createAgent.mutate(draft)
    } catch (error) { setFormError(formatError(error)) }
  }

  const editorPending = createAgent.isPending || updateAgent.isPending
  const errorMessage = agents.isError ? formatError(agents.error) : ''
  const selected = detail.data

  return (
    <main className='space-y-6 p-6'>
      <header className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <Link className='inline-flex items-center gap-1 text-sm underline underline-offset-4' to='/w/$workspaceId' params={{ workspaceId: workspace.workspace_id }}><ArrowLeft className='size-3.5' /><LocalizedText text={"返回空间"} /></Link>
          <p className='mt-3 text-sm text-muted-foreground'><LocalizedText text={"Workspace · "} />{workspace.name}</p>
          <h1 className='mt-1 text-2xl font-semibold'><LocalizedText text={"智能体"} /></h1>
          <p className='mt-1 text-sm text-muted-foreground'><LocalizedText text={"管理当前空间中的智能体定义。模型凭据和聊天会话在各自页面管理。"} /></p>
        </div>
        {canCreate && <Button onClick={openCreate}><Plus className='mr-2 size-4' /><LocalizedText text={"新建智能体"} /></Button>}
      </header>

      {workspace.status !== 'active' && <Alert><AlertDescription><LocalizedText text={"此 Workspace 已归档，当前不能读取或修改智能体。"} /></AlertDescription></Alert>}
      {errorMessage && <Alert variant='destructive'><AlertDescription>{errorMessage}</AlertDescription></Alert>}
      {deleteAgent.isError && <Alert variant='destructive'><AlertDescription>{formatError(deleteAgent.error)}</AlertDescription></Alert>}

      <div className='grid gap-5 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.4fr)]'>
        <Card>
          <CardHeader><CardTitle><LocalizedText text={"智能体列表"} /></CardTitle><CardDescription>{agents.data?.total ?? 0} <LocalizedText text={" 个定义"} /></CardDescription></CardHeader>
          <CardContent className='space-y-2'>
            {agents.isLoading ? <p className='py-5 text-sm text-muted-foreground'><LocalizedText text={"正在加载…"} /></p> : agents.data?.agents.length ? agents.data.agents.map((agent) => (
              <button key={agent.id} type='button' onClick={() => setSelectedId(agent.id)} className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent ${selectedIdInScope === agent.id ? 'border-primary bg-accent' : ''}`}>
                <span className='flex items-center gap-2 font-medium'><Bot className='size-4 text-muted-foreground' />{agent.data.name || '未命名智能体'}</span>
                <span className='mt-1 block truncate text-xs text-muted-foreground'>{agent.data.system_prompt || '没有系统提示词'}</span>
              </button>
            )) : !agents.isError && <div className='rounded-lg border border-dashed p-6 text-center'><Bot className='mx-auto size-8 text-muted-foreground' /><p className='mt-2 text-sm font-medium'><LocalizedText text={"还没有智能体"} /></p><p className='mt-1 text-xs text-muted-foreground'><LocalizedText text={"创建一个定义后，可在聊天功能中选择使用。"} /></p>{canCreate && <Button className='mt-4' size='sm' variant='outline' onClick={openCreate}><Plus className='mr-2 size-4' /><LocalizedText text={"创建智能体"} /></Button>}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle><LocalizedText text={"智能体详情"} /></CardTitle><CardDescription><LocalizedText text={"从左侧列表选择一个智能体查看完整定义。"} /></CardDescription></CardHeader>
          <CardContent>
            {!selectedIdInScope ? <p className='py-8 text-center text-sm text-muted-foreground'><LocalizedText text={"尚未选择智能体"} /></p> : detail.isLoading ? <p className='py-8 text-sm text-muted-foreground'><LocalizedText text={"正在加载详情…"} /></p> : detail.isError ? <p role='alert' className='py-4 text-sm text-destructive'>{formatError(detail.error)}</p> : selected && <div className='space-y-5'>
              <div className='flex flex-wrap items-start justify-between gap-3'><div><h2 className='text-xl font-semibold'>{selected.data.name}</h2><p className='mt-1 text-xs text-muted-foreground break-all'><LocalizedText text={"ID："} />{selected.id}</p></div><div className='flex gap-2'>{selected.editable && workspace.status === 'active' && <><Button size='sm' variant='outline' onClick={() => openEdit(selected)}><Pencil className='mr-2 size-3.5' /><LocalizedText text={"编辑"} /></Button><Button size='sm' variant='destructive' disabled={deleteAgent.isPending} onClick={() => { if (window.confirm(formatMessage('确定删除智能体“{name}”吗？', { name: selected.data.name }))) deleteAgent.mutate(selected.id) }}><Trash2 className='mr-2 size-3.5' /><LocalizedText text={"删除"} /></Button></>}</div></div>
              <section className='space-y-2'><h3 className='text-sm font-medium'><LocalizedText text={"系统提示词"} /></h3><pre className='max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm'>{selected.data.system_prompt || '（空）'}</pre></section>
              <JsonSection title='上下文配置' value={selected.data.context_config} />
              <JsonSection title='ReAct 配置' value={selected.data.react_config} />
              <JsonSection title='邀请配置' value={selected.data.invite_config} />
              {!selected.editable && <p className='text-sm text-muted-foreground'><LocalizedText text={"你可以查看此智能体，但没有编辑或删除权限。"} /></p>}
            </div>}
          </CardContent>
        </Card>
      </div>

      <Dialog open={editor !== null} onOpenChange={(open) => { if (!open && !editorPending) setEditor(null) }}>
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader><DialogTitle>{editor?.mode === 'edit' ? <LocalizedText text={"编辑智能体"} /> : <LocalizedText text={"新建智能体"} />}</DialogTitle><DialogDescription><LocalizedText text={"配置属于当前 Workspace 的智能体定义。JSON 配置需填写对象。"} /></DialogDescription></DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'><Label htmlFor='agent-name'><LocalizedText text={"名称"} /></Label><Input id='agent-name' maxLength={160} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></div>
            <div className='space-y-2'><Label htmlFor='agent-system-prompt'><LocalizedText text={"系统提示词"} /></Label><Textarea id='agent-system-prompt' className='min-h-28' value={draft.systemPrompt} onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))} /></div>
            <JsonEditor id='agent-context-config' label='上下文配置 JSON' value={draft.contextConfig} onChange={(value) => setDraft((current) => ({ ...current, contextConfig: value }))} />
            <JsonEditor id='agent-react-config' label='ReAct 配置 JSON' value={draft.reactConfig} onChange={(value) => setDraft((current) => ({ ...current, reactConfig: value }))} />
            <JsonEditor id='agent-invite-config' label='邀请配置 JSON' value={draft.inviteConfig} onChange={(value) => setDraft((current) => ({ ...current, inviteConfig: value }))} />
          </div>
          {(formError || createAgent.isError || updateAgent.isError) && <Alert variant='destructive'><AlertDescription>{formError || formatError(createAgent.error ?? updateAgent.error)}</AlertDescription></Alert>}
          <DialogFooter><Button variant='outline' disabled={editorPending} onClick={() => setEditor(null)}><LocalizedText text={"取消"} /></Button><Button disabled={editorPending || !draft.name.trim()} onClick={submit}>{editorPending ? <LocalizedText text={"保存中…"} /> : editor?.mode === 'edit' ? <LocalizedText text={"保存修改"} /> : <LocalizedText text={"创建智能体"} />}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function JsonSection({ title, value }: { title: string; value: unknown }) {
  return <section className='space-y-2'><h3 className='text-sm font-medium'><LocalizedText text={title} /></h3><pre className='max-h-52 overflow-auto rounded-md bg-muted p-3 text-xs'>{JSON.stringify(value ?? {}, null, 2)}</pre></section>
}

function JsonEditor({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <div className='space-y-2'><Label htmlFor={id}><LocalizedText text={label} /></Label><Textarea id={id} className='min-h-28 font-mono text-xs' spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} /></div>
}
