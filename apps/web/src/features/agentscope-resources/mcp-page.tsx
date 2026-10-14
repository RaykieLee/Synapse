import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react'

import {
  deleteMcp,
  getMcpCard,
  installMcp,
  listMcpCards,
  listMcpHubs,
  listMcps,
  updateMcp,
  type McpCard,
  type McpView,
} from '@/api/agentscope-resources'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DetailDialog } from '@/components/detail-dialog'
import { FormDialog } from '@/components/form-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useWorkspace } from '@/features/workspaces/context'
import { EmptyState, ResourceError, ResourceLoading, SearchBox } from './shared'
import { panel, parseJsonObject } from './shared-utils'

export function AgentScopeMcpPage({ workspaceId: workspaceIdProp }: { workspaceId?: string }) {
  const workspace = useWorkspace()
  const workspaceId = workspaceIdProp ?? workspace.workspace.workspace_id
  const client = useQueryClient()
  const [hubId, setHubId] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [editing, setEditing] = React.useState<McpView | null>(null)
  const [installing, setInstalling] = React.useState<{ hubId: string; card: McpCard } | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<McpView | null>(null)
  const [detailCard, setDetailCard] = React.useState<{ hubId: string; cardId: string } | null>(null)
  const [error, setError] = React.useState('')
  const installed = useQuery({ queryKey: ['agentscope', workspaceId, 'mcp'], queryFn: () => listMcps(workspaceId) })
  const hubs = useQuery({ queryKey: ['agentscope', workspaceId, 'mcp-hubs'], queryFn: () => listMcpHubs(workspaceId) })
  const activeHubId = hubId || hubs.data?.[0]?.hub_id || ''
  const cards = useQuery({
    queryKey: ['agentscope', workspaceId, 'mcp-cards', activeHubId, search],
    queryFn: () => listMcpCards(workspaceId, activeHubId, { q: search }),
    enabled: Boolean(activeHubId),
  })
  const refresh = () => client.invalidateQueries({ queryKey: ['agentscope', workspaceId, 'mcp'] })
  const update = useMutation({
    mutationFn: (value: { id: string; name: string; enabled: boolean }) => updateMcp(workspaceId, value.id, { name: value.name.trim(), enabled: value.enabled }),
    onSuccess: async () => { setEditing(null); setError(''); await refresh() },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '保存失败'),
  })
  const remove = useMutation({
    mutationFn: (value: McpView) => deleteMcp(workspaceId, value.id),
    onSuccess: async () => { setDeleteTarget(null); await refresh() },
  })
  const install = useMutation({
    mutationFn: (value: { hubId: string; card: McpCard; name: string; values: string }) => installMcp(workspaceId, value.hubId, value.card.id, { name: value.name.trim() || undefined, values: parseJsonObject(value.values || '{}', '安装参数') }),
    onSuccess: async () => { setInstalling(null); await refresh() },
    onError: (cause) => setError(cause instanceof Error ? cause.message : '安装失败'),
  })
  return (
    <main className='space-y-6 p-6'>
      <header><p className='text-sm text-muted-foreground'>AgentScope Resources</p><h1 className='text-2xl font-semibold'>MCP</h1><p className='mt-1 text-sm text-muted-foreground'>管理当前账号的 MCP 库，并从已配置的 Hub 安装资源。</p></header>
      <section className={panel}><h2 className='font-semibold'>已安装</h2>{installed.isLoading ? <ResourceLoading /> : installed.isError ? <ResourceError error={installed.error} /> : installed.data?.length ? <div className='mt-4 grid gap-3 md:grid-cols-2'>{installed.data.map((item) => <div key={item.id} className='rounded-lg border p-4'><div className='flex items-start justify-between gap-3'><div><h3 className='font-medium'>{item.display_name || item.name}</h3><p className='text-xs text-muted-foreground'>{item.name} · {item.enabled ? '已启用' : '已停用'}</p></div><span className={`rounded-full px-2 py-1 text-xs ${item.enabled ? 'bg-emerald-600/10 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>{item.is_stateful ? 'stateful' : 'stateless'}</span></div><p className='mt-2 text-sm text-muted-foreground'>{item.description || '暂无描述'}</p><div className='mt-3 flex flex-wrap gap-2'><DetailDialog trigger={<><Eye className='mr-1 inline size-3.5' />查看</>} title={item.display_name || item.name} description={item.description}><dl className='grid gap-2 text-sm sm:grid-cols-2'><div><dt className='text-muted-foreground'>ID</dt><dd className='break-all'>{item.id}</dd></div><div><dt className='text-muted-foreground'>版本</dt><dd>{item.version || '—'}</dd></div><div><dt className='text-muted-foreground'>Hub</dt><dd>{item.hub_id || '手动添加'}</dd></div><div><dt className='text-muted-foreground'>作者</dt><dd>{item.author || '—'}</dd></div></dl></DetailDialog><Button size='sm' variant='outline' onClick={() => { setError(''); setEditing(item) }}><Pencil className='mr-1 size-3.5' />编辑</Button><Button size='sm' variant='destructive' onClick={() => setDeleteTarget(item)}><Trash2 className='mr-1 size-3.5' />删除</Button></div></div>)}</div> : <div className='mt-4'><EmptyState>暂无已安装 MCP。</EmptyState></div>}</section>
      <section className={panel}><div className='flex flex-wrap items-center justify-between gap-3'><div><h2 className='font-semibold'>MCP Hub</h2><p className='text-sm text-muted-foreground'>浏览真实 Hub 卡片并安装到当前账号库。</p></div><div className='flex gap-2'><select className='h-9 rounded-md border bg-background px-3 text-sm' value={activeHubId} onChange={(event) => setHubId(event.target.value)}>{hubs.data?.map((hub) => <option key={hub.hub_id} value={hub.hub_id}>{hub.display_name}</option>)}</select><SearchBox value={search} onChange={setSearch} placeholder='搜索 MCP' /></div></div>{cards.isLoading ? <ResourceLoading /> : cards.isError ? <ResourceError error={cards.error} /> : cards.data?.cards.length ? <div className='mt-4 grid gap-3 md:grid-cols-2'>{cards.data.cards.map((card) => <div key={card.id} className='rounded-lg border p-4'><h3 className='font-medium'>{card.display_name || card.name}</h3><p className='mt-1 text-sm text-muted-foreground'>{card.description || '暂无描述'}</p><div className='mt-3 flex gap-2'><Button size='sm' onClick={() => { setError(''); setInstalling({ hubId: activeHubId, card }) }}><Plus className='mr-1 size-3.5' />安装</Button><Button size='sm' variant='outline' onClick={() => setDetailCard({ hubId: activeHubId, cardId: card.id })}>查看配置</Button></div></div>)}</div> : <div className='mt-4'><EmptyState>Hub 没有返回匹配卡片。</EmptyState></div>}</section>
      <FormDialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)} title='编辑 MCP' formAriaLabel='编辑 MCP' submitLabel='保存修改' pending={update.isPending} error={error} onCancel={() => setEditing(null)} onSubmit={() => editing && update.mutate(editing)}><div className='space-y-3'><label className='block space-y-1 text-sm'>名称<Input value={editing?.name ?? ''} onChange={(event) => setEditing((value) => value && { ...value, name: event.target.value })} /></label><label className='flex items-center gap-2 text-sm'><input type='checkbox' checked={editing?.enabled ?? false} onChange={(event) => setEditing((value) => value && { ...value, enabled: event.target.checked })} />启用 MCP</label><p className='text-xs text-muted-foreground'>出于安全原因，后端不会在列表响应中返回已保存的密钥参数。</p></div></FormDialog>
      <McpInstallDialog key={installing?.card.id ?? 'mcp-install'} target={installing} open={Boolean(installing)} pending={install.isPending} error={error} onClose={() => setInstalling(null)} onSubmit={(value) => installing && install.mutate({ ...value, hubId: installing.hubId, card: installing.card })} />
      <McpCardDialog target={detailCard} workspaceId={workspaceId} onClose={() => setDetailCard(null)} />
      <ConfirmDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)} title='删除 MCP' desc={`将从当前账号库移除“${deleteTarget?.display_name || deleteTarget?.name || ''}”。`} destructive confirmText='确认删除' isLoading={remove.isPending} handleConfirm={() => deleteTarget && remove.mutate(deleteTarget)} />
    </main>
  )
}

function McpInstallDialog({ target, open, pending, error, onClose, onSubmit }: { target: { hubId: string; card: McpCard } | null; open: boolean; pending: boolean; error: string; onClose: () => void; onSubmit: (value: { name: string; values: string }) => void }) {
  const [name, setName] = React.useState(target?.card.name ?? '')
  const [values, setValues] = React.useState('{}')
  return <FormDialog open={open} onOpenChange={(value) => !value && onClose()} title={`安装 MCP：${target?.card.display_name || target?.card.name || ''}`} formAriaLabel='安装 MCP' submitLabel='安装到我的库' pending={pending} error={error} onCancel={onClose} onSubmit={() => onSubmit({ name, values })}><div className='space-y-3'><label className='block space-y-1 text-sm'>库内名称<Input value={name} onChange={(event) => setName(event.target.value)} /></label><label className='block space-y-1 text-sm'>输入参数 JSON<Textarea className='min-h-32 font-mono text-xs' value={values} onChange={(event) => setValues(event.target.value)} /></label><pre className='max-h-40 overflow-auto rounded bg-muted/50 p-3 text-xs'>{JSON.stringify(target?.card.inputs_schema ?? {}, null, 2)}</pre></div></FormDialog>
}

function McpCardDialog({ target, workspaceId, onClose }: { target: { hubId: string; cardId: string } | null; workspaceId: string; onClose: () => void }) {
  const card = useQuery({ queryKey: ['agentscope', workspaceId, 'mcp-card', target?.hubId, target?.cardId], queryFn: () => getMcpCard(workspaceId, target!.hubId, target!.cardId), enabled: Boolean(target) })
  return <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>{card.data?.display_name || card.data?.name || 'MCP 配置'}</DialogTitle><DialogDescription>{card.data?.description}</DialogDescription></DialogHeader>{card.isLoading ? '正在加载…' : card.isError ? card.error.message : <pre className='max-h-[60vh] overflow-auto rounded bg-muted/40 p-3 text-xs'>{JSON.stringify(card.data?.inputs_schema ?? {}, null, 2)}</pre>}</DialogContent></Dialog>
}
