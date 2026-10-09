import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useWorkspace } from './context'
import type { Page, Workspace, WorkspaceRole, WorkspaceStatus } from './types'
import { roleLabel, statusLabel } from './types'

const panel = 'rounded-xl border bg-card p-5'
const scopedKey = (actorId: string, workspace: Workspace, resource: string) =>
  ['synapse', actorId, workspace.tenant_id, workspace.workspace_id, resource, workspace.membership_version ?? 0] as const
const scopedHeaders = (workspace: Workspace) => ({ 'X-Workspace-ID': workspace.workspace_id })

export function WorkspaceHome() {
  const { workspace } = useWorkspace()
  const manager = workspace.workspace_role === 'owner' || workspace.workspace_role === 'admin'
  return (
    <main className='space-y-6 p-6'>
      <header><p className='text-sm text-muted-foreground'>Workspace · {workspace.slug}</p><h1 className='mt-1 text-2xl font-semibold'>{workspace.name}</h1><p className='mt-2 text-sm text-muted-foreground'>{statusLabel[workspace.status]} · 我的空间角色：{roleLabel[workspace.workspace_role]}</p></header>
      {workspace.status === 'archived' && <section className={`${panel} border-amber-500/40`}><h2 className='font-semibold'>此空间已归档</h2><p className='mt-1 text-sm text-muted-foreground'>空间成员和资源关系已保留。所有者或管理员可以在设置中恢复。</p>{manager && <Link className='mt-3 inline-block text-sm underline underline-offset-4' to='/w/$workspaceId/settings' params={{ workspaceId: workspace.workspace_id }}>打开空间设置</Link>}</section>}
      <section className={panel}><h2 className='font-semibold'>空间资源</h2><p className='mt-1 text-sm text-muted-foreground'>智能体定义、会话和文件按当前 Workspace 作用域隔离。</p><div className='mt-4 flex flex-wrap gap-2'><Link to='/w/$workspaceId/agents' params={{ workspaceId: workspace.workspace_id }}><Button variant='outline'>智能体管理</Button></Link><Link to='/w/$workspaceId/sessions' params={{ workspaceId: workspace.workspace_id }}><Button variant='outline'>会话管理</Button></Link><Link to='/w/$workspaceId/attachments' params={{ workspaceId: workspace.workspace_id }}><Button variant='outline'>附件</Button></Link></div></section>
      <section className={panel}><h2 className='font-semibold'>空间管理</h2><p className='mt-1 text-sm text-muted-foreground'>空间成员资格独立于租户成员资格；只有加入该空间的成员才能访问其业务资源。</p><div className='mt-4 flex flex-wrap gap-2'><Link to='/w/$workspaceId/members' params={{ workspaceId: workspace.workspace_id }}><Button variant='outline'>成员管理</Button></Link>{manager && <Link to='/w/$workspaceId/settings' params={{ workspaceId: workspace.workspace_id }}><Button variant='outline'>空间设置</Button></Link>}</div></section>
    </main>
  )
}

export function WorkspaceSettings() {
  const { workspace, actorId } = useWorkspace()
  const client = useQueryClient()
  const canManage = workspace.workspace_role === 'owner' || workspace.workspace_role === 'admin'
  const [name, setName] = React.useState(workspace.name)
  const [icon, setIcon] = React.useState(workspace.icon ?? '')
  const [error, setError] = React.useState('')
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: scopedKey(actorId, workspace, 'workspace-detail') })
    await client.invalidateQueries({ queryKey: ['synapse', actorId, 'global', 'personal', 'workspace-directory'] })
  }
  const update = useMutation({
    mutationFn: (body: object) => api<Workspace>(`/workspaces/${workspace.workspace_id}`, { method: 'PATCH', headers: scopedHeaders(workspace), body: JSON.stringify(body) }),
    onSuccess: async () => { setError(''); await refresh() }, onError: (cause) => setError(cause instanceof Error ? cause.message : '更新失败'),
  })
  const setStatus = useMutation({
    mutationFn: (status: WorkspaceStatus) => api<Workspace>(`/workspaces/${workspace.workspace_id}`, { method: 'PATCH', headers: scopedHeaders(workspace), body: JSON.stringify({ status }) }),
    onSuccess: async () => { setError(''); await refresh() }, onError: (cause) => setError(cause instanceof Error ? cause.message : '状态更新失败'),
  })
  if (!canManage) return <NoPermission />
  return (
    <main className='space-y-6 p-6'>
      <header><Link className='text-sm underline underline-offset-4' to='/w/$workspaceId' params={{ workspaceId: workspace.workspace_id }}>← 返回空间</Link><p className='mt-3 text-sm text-muted-foreground'>Workspace 设置</p><h1 className='text-2xl font-semibold'>{workspace.name}</h1></header>
      <section className={`${panel} max-w-2xl space-y-4`}><h2 className='font-semibold'>基本信息</h2><div className='space-y-2'><Label htmlFor='workspace-name-edit'>名称</Label><Input id='workspace-name-edit' value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></div><div className='space-y-2'><Label htmlFor='workspace-icon-edit'>图标标识（可选）</Label><Input id='workspace-icon-edit' value={icon} onChange={(event) => setIcon(event.target.value)} maxLength={64} /></div><div className='grid gap-2 text-sm sm:grid-cols-2'><div><span className='text-muted-foreground'>空间标识：</span>{workspace.slug}</div><div><span className='text-muted-foreground'>租户 ID：</span>{workspace.tenant_id}</div><div><span className='text-muted-foreground'>空间 ID：</span>{workspace.workspace_id}</div><div><span className='text-muted-foreground'>状态：</span>{statusLabel[workspace.status]}</div></div><Button disabled={!name.trim() || update.isPending} onClick={() => update.mutate({ name: name.trim(), icon: icon.trim() || null })}>{update.isPending ? '保存中…' : '保存设置'}</Button></section>
      <section className={`${panel} max-w-2xl`}><h2 className='font-semibold'>归档空间</h2><p className='mt-1 text-sm text-muted-foreground'>归档后空间不会出现在普通空间列表中，成员关系和资源保留。所有者或管理员可以从切换器的管理列表恢复。</p><Button className='mt-4' variant={workspace.status === 'active' ? 'destructive' : 'default'} disabled={setStatus.isPending} onClick={() => {
        if (workspace.status === 'active' && !window.confirm(`确定归档“${workspace.name}”吗？`)) return
        setStatus.mutate(workspace.status === 'active' ? 'archived' : 'active')
      }}>{workspace.status === 'active' ? '归档空间' : '恢复空间'}</Button></section>
      {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
    </main>
  )
}

type Member = { user_id: string; user_name: string; nick_name: string | null; email: string | null; status: string; workspace_role: WorkspaceRole; joined_at: string | null }

export function WorkspaceMembers() {
  const { workspace, actorId } = useWorkspace()
  const client = useQueryClient()
  const [page, setPage] = React.useState(1)
  const [targetId, setTargetId] = React.useState('')
  const [targetRole, setTargetRole] = React.useState<WorkspaceRole>('member')
  const [newOwnerId, setNewOwnerId] = React.useState('')
  const [error, setError] = React.useState('')
  const canManage = workspace.workspace_role === 'owner' || workspace.workspace_role === 'admin'
  const canEdit = canManage && workspace.status === 'active'
  const isOwner = workspace.workspace_role === 'owner'
  const membersKey = [...scopedKey(actorId, workspace, 'workspace-members'), page, 20] as const
  const members = useQuery({
    queryKey: membersKey,
    queryFn: () => api<Page<Member>>(`/workspaces/${workspace.workspace_id}/members?page=${page}&page_size=20`, { headers: scopedHeaders(workspace) }),
    enabled: workspace.status === 'active' || canManage,
  })
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: scopedKey(actorId, workspace, 'workspace-members') })
    await client.invalidateQueries({ queryKey: ['synapse', actorId, 'global', 'personal', 'workspace-directory'] })
    await client.invalidateQueries({ queryKey: scopedKey(actorId, workspace, 'workspace-detail') })
  }
  const changeRole = useMutation({
    mutationFn: ({ userId, workspace_role }: { userId: string; workspace_role: WorkspaceRole }) => api(`/workspaces/${workspace.workspace_id}/members/${userId}`, { method: 'PUT', headers: scopedHeaders(workspace), body: JSON.stringify({ workspace_role }) }),
    onSuccess: async () => { setError(''); setTargetId(''); await refresh() }, onError: (cause) => setError(cause instanceof Error ? cause.message : '成员更新失败'),
  })
  const remove = useMutation({
    mutationFn: (userId: string) => api(`/workspaces/${workspace.workspace_id}/members/${userId}`, { method: 'DELETE', headers: scopedHeaders(workspace) }),
    onSuccess: refresh, onError: (cause) => setError(cause instanceof Error ? cause.message : '成员移除失败'),
  })
  const transfer = useMutation({
    mutationFn: (userId: string) => api(`/workspaces/${workspace.workspace_id}/transfer-ownership`, { method: 'POST', headers: scopedHeaders(workspace), body: JSON.stringify({ new_owner_user_id: userId }) }),
    onSuccess: async () => { setError(''); setNewOwnerId(''); await refresh() }, onError: (cause) => setError(cause instanceof Error ? cause.message : '所有权转移失败'),
  })
  if (workspace.status === 'archived' && !canManage) return <NoPermission />
  return (
    <main className='space-y-6 p-6'>
      <header><Link className='text-sm underline underline-offset-4' to='/w/$workspaceId' params={{ workspaceId: workspace.workspace_id }}>← 返回空间</Link><p className='mt-3 text-sm text-muted-foreground'>Workspace · {workspace.name}</p><h1 className='text-2xl font-semibold'>空间成员</h1><p className='mt-1 text-sm text-muted-foreground'>成员必须是所属租户的 active 成员。租户成员不会自动加入所有空间。</p></header>
      {canEdit && <section className={`${panel} space-y-3`}><h2 className='font-semibold'>添加或恢复成员</h2><p className='text-sm text-muted-foreground'>输入现有全局账号 ID；API 会校验其当前租户成员资格。</p><div className='flex flex-wrap items-end gap-3'><div className='space-y-2'><Label htmlFor='workspace-member-id'>用户 ID</Label><Input id='workspace-member-id' inputMode='numeric' pattern='[0-9]+' value={targetId} onChange={(event) => setTargetId(event.target.value)} className='w-48' /></div><div className='space-y-2'><Label htmlFor='workspace-member-role'>角色</Label><select id='workspace-member-role' className='h-9 rounded-md border bg-background px-3 text-sm' value={targetRole} onChange={(event) => setTargetRole(event.target.value as WorkspaceRole)}><option value='member'>成员</option><option value='viewer'>只读成员</option><option value='admin'>管理员</option>{isOwner && <option value='owner'>所有者</option>}</select></div><Button disabled={!/^\d+$/.test(targetId) || changeRole.isPending} onClick={() => changeRole.mutate({ userId: targetId, workspace_role: targetRole })}>{changeRole.isPending ? '保存中…' : '加入空间'}</Button></div></section>}
      <section className={panel}><h2 className='font-semibold'>成员列表</h2>{members.isLoading ? <p className='py-5 text-sm text-muted-foreground'>正在加载…</p> : members.isError ? <p role='alert' className='py-5 text-sm text-destructive'>{members.error.message}</p> : members.data?.items.length ? <div className='mt-3 overflow-x-auto'><table className='w-full text-left text-sm'><thead><tr className='border-b text-muted-foreground'><th className='p-3'>成员</th><th className='p-3'>用户 ID</th><th className='p-3'>角色</th><th className='p-3'>状态</th>{canManage && <th className='p-3'>操作</th>}</tr></thead><tbody>{members.data.items.map((member) => {
          const isTargetOwner = member.workspace_role === 'owner'
          const protectedOwner = isTargetOwner && !isOwner
          return <tr key={member.user_id} className='border-b last:border-0'><td className='p-3'>{member.nick_name || member.user_name}{member.email && <span className='block text-muted-foreground'>{member.email}</span>}</td><td className='p-3'>{member.user_id}</td><td className='p-3'>{canEdit && !protectedOwner && member.status === 'active' ? <select aria-label={`${member.user_name} 空间角色`} className='rounded border bg-background p-1' value={member.workspace_role} onChange={(event) => changeRole.mutate({ userId: member.user_id, workspace_role: event.target.value as WorkspaceRole })}><option value='member'>成员</option><option value='viewer'>只读成员</option><option value='admin'>管理员</option>{isOwner && <option value='owner'>所有者</option>}</select> : roleLabel[member.workspace_role]}</td><td className='p-3'>{member.status === 'active' ? '有效' : member.status === 'removed' ? '已移除' : member.status}</td>{canManage && <td className='space-x-3 p-3'>{workspace.status === 'archived' ? '归档空间只读' : protectedOwner ? '管理员不能操作所有者' : member.status === 'active' ? <button className='underline' onClick={() => { if (window.confirm(`确定从空间移除“${member.nick_name || member.user_name}”吗？`)) remove.mutate(member.user_id) }}>移除</button> : workspace.status === 'active' && <button className='underline' onClick={() => changeRole.mutate({ userId: member.user_id, workspace_role: member.workspace_role === 'owner' && !isOwner ? 'member' : member.workspace_role })}>重新加入</button>}{isOwner && member.status === 'active' && !isTargetOwner && workspace.status === 'active' && <button className='ml-3 underline' onClick={() => { setNewOwnerId(member.user_id); if (window.confirm(`将空间所有权转交给“${member.nick_name || member.user_name}”？你将变为空间管理员。`)) transfer.mutate(member.user_id) }}>转移所有权</button>}</td>}</tr>
        })}</tbody></table><div className='mt-4 flex items-center justify-between text-sm'><span>共 {members.data.total} 人</span><div className='flex gap-2'><Button size='sm' variant='outline' disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</Button><Button size='sm' variant='outline' disabled={page * 20 >= members.data.total} onClick={() => setPage((value) => value + 1)}>下一页</Button></div></div></div> : <p className='py-5 text-center text-sm text-muted-foreground'>暂无成员</p>}</section>
      {isOwner && workspace.status === 'active' && <section className={`${panel} max-w-xl space-y-3`}><h2 className='font-semibold'>转移空间所有权</h2><p className='text-sm text-muted-foreground'>新所有者必须已经是该空间的 active 成员。转移完成后你会成为管理员。</p><div className='flex items-end gap-3'><div className='space-y-2'><Label htmlFor='new-owner-id'>新所有者用户 ID</Label><Input id='new-owner-id' inputMode='numeric' pattern='[0-9]+' value={newOwnerId} onChange={(event) => setNewOwnerId(event.target.value)} /></div><Button variant='outline' disabled={!/^\d+$/.test(newOwnerId) || transfer.isPending} onClick={() => { if (window.confirm('确认转移空间所有权？')) transfer.mutate(newOwnerId) }}>{transfer.isPending ? '转移中…' : '确认转移'}</Button></div></section>}
      {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
    </main>
  )
}

function NoPermission() {
  return <main className='space-y-3 p-6'><h1 className='text-xl font-semibold'>没有管理权限</h1><p className='text-sm text-muted-foreground'>当前 Workspace 角色无权管理此页面。</p></main>
}
