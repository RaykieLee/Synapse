import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Plus, Trash2 } from 'lucide-react'

import {
  deleteSkill,
  getSkill,
  installSkill,
  listSkillCards,
  listSkillHubs,
  listSkills,
  type SkillCard,
  type SkillView,
} from '@/api/agentscope-resources'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DetailDialog } from '@/components/detail-dialog'
import { FormDialog } from '@/components/form-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWorkspace } from '@/features/workspaces/context'
import { EmptyState, ResourceError, ResourceLoading, SearchBox } from './shared'
import { panel } from './shared-utils'

export function AgentScopeSkillsPage({ workspaceId: workspaceIdProp }: { workspaceId?: string }) {
  const workspace = useWorkspace()
  const workspaceId = workspaceIdProp ?? workspace.workspace.workspace_id
  const client = useQueryClient()
  const [hubId, setHubId] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [installing, setInstalling] = React.useState<{ hubId: string; card: SkillCard } | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<SkillView | null>(null)
  const hubs = useQuery({ queryKey: ['agentscope', workspaceId, 'skill-hubs'], queryFn: () => listSkillHubs(workspaceId) })
  const installed = useQuery({ queryKey: ['agentscope', workspaceId, 'skills'], queryFn: () => listSkills(workspaceId) })
  const activeHubId = hubId || hubs.data?.[0]?.hub_id || ''
  const cards = useQuery({ queryKey: ['agentscope', workspaceId, 'skill-cards', activeHubId, search], queryFn: () => listSkillCards(workspaceId, activeHubId, { q: search }), enabled: Boolean(activeHubId) })
  const remove = useMutation({ mutationFn: (value: SkillView) => deleteSkill(workspaceId, value.id), onSuccess: async () => { setDeleteTarget(null); await client.invalidateQueries({ queryKey: ['agentscope', workspaceId, 'skills'] }) } })
  const install = useMutation({ mutationFn: (value: { hubId: string; card: SkillCard; name: string }) => installSkill(workspaceId, value.hubId, value.card.id, value.name.trim() || undefined), onSuccess: async () => { setInstalling(null); await client.invalidateQueries({ queryKey: ['agentscope', workspaceId, 'skills'] }) } })
  return <main className='space-y-6 p-6'><header><p className='text-sm text-muted-foreground'>AgentScope Resources</p><h1 className='text-2xl font-semibold'>Skills</h1><p className='mt-1 text-sm text-muted-foreground'>管理已安装技能并从 Hub 安装新的 SKILL.md。</p></header><section className={panel}><h2 className='font-semibold'>已安装</h2>{installed.isLoading ? <ResourceLoading /> : installed.isError ? <ResourceError error={installed.error} /> : installed.data?.length ? <div className='mt-4 grid gap-3 md:grid-cols-2'>{installed.data.map((item) => <div key={item.id} className='rounded-lg border p-4'><h3 className='font-medium'>{item.display_name || item.name}</h3><p className='mt-1 text-sm text-muted-foreground'>{item.description || '暂无描述'}</p><div className='mt-3 flex gap-2'>{item.hub_id && item.card_id && <SkillDetailButton workspaceId={workspaceId} item={item} />}<Button size='sm' variant='destructive' onClick={() => setDeleteTarget(item)}><Trash2 className='mr-1 size-3.5' />删除</Button></div></div>)}</div> : <div className='mt-4'><EmptyState>暂无已安装 Skill。</EmptyState></div>}</section><section className={panel}><div className='flex flex-wrap items-center justify-between gap-3'><div><h2 className='font-semibold'>Skill Hub</h2><p className='text-sm text-muted-foreground'>浏览并安装真实 Hub 资源。</p></div><div className='flex gap-2'><select className='h-9 rounded-md border bg-background px-3 text-sm' value={activeHubId} onChange={(event) => setHubId(event.target.value)}>{hubs.data?.map((hub) => <option key={hub.hub_id} value={hub.hub_id}>{hub.display_name}</option>)}</select><SearchBox value={search} onChange={setSearch} placeholder='搜索 Skill' /></div></div>{cards.isLoading ? <ResourceLoading /> : cards.isError ? <ResourceError error={cards.error} /> : cards.data?.cards.length ? <div className='mt-4 grid gap-3 md:grid-cols-2'>{cards.data.cards.map((card) => <div key={card.id} className='rounded-lg border p-4'><h3 className='font-medium'>{card.display_name || card.name}</h3><p className='mt-1 text-sm text-muted-foreground'>{card.description || '暂无描述'}</p><Button className='mt-3' size='sm' onClick={() => setInstalling({ hubId: activeHubId, card })}><Plus className='mr-1 size-3.5' />安装</Button></div>)}</div> : <div className='mt-4'><EmptyState>Hub 没有返回匹配卡片。</EmptyState></div>}</section><SkillInstallDialog key={installing?.card.id ?? 'skill-install'} target={installing} open={Boolean(installing)} pending={install.isPending} onClose={() => setInstalling(null)} onSubmit={(name) => installing && install.mutate({ ...installing, name })} /><ConfirmDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)} title='删除 Skill' desc={`将从当前账号库移除“${deleteTarget?.display_name || deleteTarget?.name || ''}”。`} destructive confirmText='确认删除' isLoading={remove.isPending} handleConfirm={() => deleteTarget && remove.mutate(deleteTarget)} /></main>
}

function SkillInstallDialog({ target, open, pending, onClose, onSubmit }: { target: { hubId: string; card: SkillCard } | null; open: boolean; pending: boolean; onClose: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = React.useState(target?.card.name ?? '')
  return <FormDialog open={open} onOpenChange={(value) => !value && onClose()} title={`安装 Skill：${target?.card.display_name || target?.card.name || ''}`} formAriaLabel='安装 Skill' submitLabel='安装到我的库' pending={pending} onCancel={onClose} onSubmit={() => onSubmit(name)}><label className='block space-y-1 text-sm'>库内名称<Input value={name} onChange={(event) => setName(event.target.value)} /></label></FormDialog>
}

function SkillDetailButton({ workspaceId, item }: { workspaceId: string; item: SkillView }) {
  const detail = useQuery({ queryKey: ['agentscope', workspaceId, 'skill', item.id], queryFn: () => getSkill(workspaceId, item.id) })
  return <DetailDialog trigger={<><Eye className='mr-1 inline size-3.5' />查看内容</>} title={item.display_name || item.name} description={item.description}><div className='max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-3 font-mono text-xs'>{detail.isLoading ? '正在加载…' : detail.isError ? detail.error.message : detail.data?.markdown || '暂无 SKILL.md 内容'}</div></DetailDialog>
}
