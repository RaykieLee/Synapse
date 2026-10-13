import * as React from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  listWorkspaceMembers,
  putWorkspaceMember,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
  updateWorkspace,
  type WorkspaceMember,
} from '@/api/workspaces'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useWorkspace } from './context'
import {
  roleLabel,
  statusLabel,
  type Workspace,
  type WorkspaceRole,
  type WorkspaceStatus,
} from './types'
import { LocalizedText } from '@/components/localized-text'
import { FormDialog } from '@/components/form-dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const panel = 'rounded-xl border bg-card p-5'
const scopedKey = (actorId: string, workspace: Workspace, resource: string) =>
  [
    'synapse',
    actorId,
    workspace.tenant_id,
    workspace.workspace_id,
    resource,
    workspace.membership_version ?? 0,
  ] as const
export function WorkspaceHome() {
  const { workspace } = useWorkspace()
  const manager =
    workspace.workspace_role === 'owner' || workspace.workspace_role === 'admin'
  return (
    <main className='space-y-6 p-6'>
      <header>
        <p className='text-sm text-muted-foreground'>
          <LocalizedText text={"\n          Workspace · "} />{workspace.slug}
        </p>
        <h1 className='mt-1 text-2xl font-semibold'>{workspace.name}</h1>
        <p className='mt-2 text-sm text-muted-foreground'>
          {statusLabel[workspace.status]} <LocalizedText text={" · 我的空间角色：\n          "} />{roleLabel[workspace.workspace_role]}
        </p>
      </header>
      {workspace.status === 'archived' && (
        <section className={`${panel} border-amber-500/40`}>
          <h2 className='font-semibold'><LocalizedText text={"此空间已归档"} /></h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            <LocalizedText text={"\n            空间成员和资源关系已保留。所有者或管理员可以在设置中恢复。\n          "} /></p>
          {manager && (
            <Link
              className='mt-3 inline-block text-sm underline underline-offset-4'
              to='/w/$workspaceId/settings'
              params={{ workspaceId: workspace.workspace_id }}
            >
              <LocalizedText text={"\n              打开空间设置\n            "} /></Link>
          )}
        </section>
      )}
      <section className={panel}>
        <h2 className='font-semibold'><LocalizedText text={"空间资源"} /></h2>
        <p className='mt-1 text-sm text-muted-foreground'>
          <LocalizedText text={"\n          智能体定义、会话和文件按当前 Workspace 作用域隔离。\n        "} /></p>
        <div className='mt-4 flex flex-wrap gap-2'>
          <Link
            to='/w/$workspaceId/agents'
            params={{ workspaceId: workspace.workspace_id }}
          >
            <Button variant='outline'><LocalizedText text={"智能体管理"} /></Button>
          </Link>
          <Link
            to='/w/$workspaceId/sessions'
            params={{ workspaceId: workspace.workspace_id }}
          >
            <Button variant='outline'><LocalizedText text={"会话管理"} /></Button>
          </Link>
          <Link
            to='/w/$workspaceId/teams'
            params={{ workspaceId: workspace.workspace_id }}
          >
            <Button variant='outline'><LocalizedText text={"子智能体团队"} /></Button>
          </Link>
          <Link
            to='/w/$workspaceId/attachments'
            params={{ workspaceId: workspace.workspace_id }}
          >
            <Button variant='outline'><LocalizedText text={"附件"} /></Button>
          </Link>
        </div>
      </section>
      <section className={panel}>
        <h2 className='font-semibold'><LocalizedText text={"空间管理"} /></h2>
        <p className='mt-1 text-sm text-muted-foreground'>
          <LocalizedText text={"\n          空间成员资格独立于租户成员资格；只有加入该空间的成员才能访问其业务资源。\n        "} /></p>
        <div className='mt-4 flex flex-wrap gap-2'>
          <Link
            to='/w/$workspaceId/members'
            params={{ workspaceId: workspace.workspace_id }}
          >
            <Button variant='outline'><LocalizedText text={"成员管理"} /></Button>
          </Link>
          {manager && (
            <Link
              to='/w/$workspaceId/settings'
              params={{ workspaceId: workspace.workspace_id }}
            >
              <Button variant='outline'><LocalizedText text={"空间设置"} /></Button>
            </Link>
          )}
        </div>
      </section>
    </main>
  )
}

export function WorkspaceSettings() {
  const { workspace, actorId } = useWorkspace()
  const client = useQueryClient()
  const canManage =
    workspace.workspace_role === 'owner' || workspace.workspace_role === 'admin'
  const [name, setName] = React.useState(workspace.name)
  const [icon, setIcon] = React.useState(workspace.icon ?? '')
  const [basicOpen, setBasicOpen] = React.useState(false)
  const [archiveOpen, setArchiveOpen] = React.useState(false)
  const [error, setError] = React.useState('')
  const refresh = async () => {
    await client.invalidateQueries({
      queryKey: scopedKey(actorId, workspace, 'workspace-detail'),
    })
    await client.invalidateQueries({
      queryKey: [
        'synapse',
        actorId,
        'global',
        'personal',
        'workspace-directory',
      ],
    })
  }
  const update = useMutation({
    mutationFn: (body: Parameters<typeof updateWorkspace>[1]) =>
      updateWorkspace(workspace.workspace_id, body),
    onSuccess: async () => {
      setError('')
      setBasicOpen(false)
      await refresh()
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : '更新失败'),
  })
  const setStatus = useMutation({
    mutationFn: (status: WorkspaceStatus) =>
      updateWorkspace(workspace.workspace_id, { status }),
    onSuccess: async () => {
      setError('')
      await refresh()
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : '状态更新失败'),
  })
  if (!canManage) return <NoPermission />
  return (
    <main className='space-y-6 p-6'>
      <header>
        <p className='mt-3 text-sm text-muted-foreground'><LocalizedText text={"Workspace 设置"} /></p>
        <h1 className='text-2xl font-semibold'>{workspace.name}</h1>
      </header>
      <section className={`${panel} max-w-2xl space-y-4`}>
        <h2 className='font-semibold'><LocalizedText text={"基本信息"} /></h2>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <p className='font-medium'>{workspace.name}</p>
            <p className='text-sm text-muted-foreground'>
              {workspace.icon || <LocalizedText text={'未设置图标标识'} />}
            </p>
          </div>
          <Button variant='outline' onClick={() => { setError(''); setName(workspace.name); setIcon(workspace.icon ?? ''); setBasicOpen(true) }}>
            <LocalizedText text='编辑基本信息' />
          </Button>
        </div>
        <div className='grid gap-2 text-sm sm:grid-cols-2'>
          <div>
            <span className='text-muted-foreground'><LocalizedText text={"空间标识："} /></span>
            {workspace.slug}
          </div>
          <div>
            <span className='text-muted-foreground'><LocalizedText text={"租户 ID："} /></span>
            {workspace.tenant_id}
          </div>
          <div>
            <span className='text-muted-foreground'><LocalizedText text={"空间 ID："} /></span>
            {workspace.workspace_id}
          </div>
          <div>
            <span className='text-muted-foreground'><LocalizedText text={"状态："} /></span>
            {statusLabel[workspace.status]}
          </div>
        </div>
        <FormDialog
          open={basicOpen}
          onOpenChange={setBasicOpen}
          title={<LocalizedText text='编辑 Workspace 基本信息' />}
          formAriaLabel='编辑 Workspace 基本信息'
          description={<LocalizedText text='修改名称和图标标识，保存后会刷新当前 Workspace 导航。' />}
          error={error}
          submitLabel={<LocalizedText text='保存设置' />}
          pending={update.isPending}
          disabled={!name.trim()}
          onSubmit={() => update.mutate({ name: name.trim(), icon: icon.trim() || null })}
          onCancel={() => setBasicOpen(false)}
        >
          <div className='space-y-3'>
            <div className='space-y-2'>
              <Label htmlFor='workspace-name-edit'><LocalizedText text={"名称"} /></Label>
              <Input id='workspace-name-edit' autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='workspace-icon-edit'><LocalizedText text={"图标标识（可选）"} /></Label>
              <Input id='workspace-icon-edit' value={icon} onChange={(event) => setIcon(event.target.value)} maxLength={64} />
            </div>
          </div>
        </FormDialog>
      </section>
      <section className={`${panel} max-w-2xl`}>
        <h2 className='font-semibold'><LocalizedText text={"归档空间"} /></h2>
        <p className='mt-1 text-sm text-muted-foreground'>
          <LocalizedText text={"\n          归档后空间不会出现在普通空间列表中，成员关系和资源保留。所有者或管理员可以从切换器的管理列表恢复。\n        "} /></p>
        <Button
          className='mt-4'
          variant={workspace.status === 'active' ? "destructive" : "default"}
          disabled={setStatus.isPending}
          onClick={() => workspace.status === 'active' ? setArchiveOpen(true) : setStatus.mutate('active')}
        >
          {workspace.status === 'active' ? <LocalizedText text={"归档空间"} /> : <LocalizedText text={"恢复空间"} />}
        </Button>
      </section>
      {error && (
        <p role='alert' className='text-sm text-destructive'>
          {error}
        </p>
      )}
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={(open) => { if (!open && !setStatus.isPending) setArchiveOpen(false) }}
        title='归档 Workspace'
        desc='归档后空间不会出现在普通空间列表中，成员关系和资源会保留。'
        confirmText='确认归档'
        destructive
        isLoading={setStatus.isPending}
        handleConfirm={() => setStatus.mutate('archived', { onSuccess: () => setArchiveOpen(false) })}
      >
        <p className='text-sm font-medium'>{workspace.name}</p>
      </ConfirmDialog>
    </main>
  )
}

export function WorkspaceMembers() {
  const { workspace, actorId } = useWorkspace()
  const client = useQueryClient()
  const [page, setPage] = React.useState(1)
  const [targetId, setTargetId] = React.useState('')
  const [targetRole, setTargetRole] = React.useState<WorkspaceRole>('member')
  const [newOwnerId, setNewOwnerId] = React.useState('')
  const [addOpen, setAddOpen] = React.useState(false)
  const [roleTarget, setRoleTarget] = React.useState<{ member: WorkspaceMember; role: WorkspaceRole } | null>(null)
  const [actionTarget, setActionTarget] = React.useState<{ kind: 'remove' | 'rejoin'; member: WorkspaceMember } | null>(null)
  const [transferTarget, setTransferTarget] = React.useState<WorkspaceMember | null>(null)
  const [transferOpen, setTransferOpen] = React.useState(false)
  const [error, setError] = React.useState('')
  const canManage =
    workspace.workspace_role === 'owner' || workspace.workspace_role === 'admin'
  const canEdit = canManage && workspace.status === 'active'
  const isOwner = workspace.workspace_role === 'owner'
  const membersKey = [
    ...scopedKey(actorId, workspace, 'workspace-members'),
    page,
    20,
  ] as const
  const members = useQuery({
    queryKey: membersKey,
    queryFn: () =>
      listWorkspaceMembers(workspace.workspace_id, { page, pageSize: 20 }),
    enabled: workspace.status === 'active' || canManage,
  })
  const refresh = async () => {
    await client.invalidateQueries({
      queryKey: scopedKey(actorId, workspace, 'workspace-members'),
    })
    await client.invalidateQueries({
      queryKey: [
        'synapse',
        actorId,
        'global',
        'personal',
        'workspace-directory',
      ],
    })
    await client.invalidateQueries({
      queryKey: scopedKey(actorId, workspace, 'workspace-detail'),
    })
  }
  const changeRole = useMutation({
    mutationFn: ({
      userId,
      workspace_role,
    }: {
      userId: string
      workspace_role: WorkspaceRole
    }) =>
      putWorkspaceMember(workspace.workspace_id, userId, { workspace_role }),
    onSuccess: async () => {
      setError('')
      setTargetId('')
      setRoleTarget(null)
      setAddOpen(false)
      setTransferOpen(false)
      setTransferTarget(null)
      await refresh()
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : '成员更新失败'),
  })
  const remove = useMutation({
    mutationFn: (userId: string) =>
      removeWorkspaceMember(workspace.workspace_id, userId),
    onSuccess: refresh,
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : '成员移除失败'),
  })
  const transfer = useMutation({
    mutationFn: (userId: string) =>
      transferWorkspaceOwnership(workspace.workspace_id, userId),
    onSuccess: async () => {
      setError('')
      setNewOwnerId('')
      setTransferOpen(false)
      setTransferTarget(null)
      await refresh()
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : '所有权转移失败'),
  })
  if (workspace.status === 'archived' && !canManage) return <NoPermission />
  return (
    <main className='space-y-6 p-6'>
      <header>
        <p className='mt-3 text-sm text-muted-foreground'>
          <LocalizedText text={"\n          Workspace · "} />{workspace.name}
        </p>
        <h1 className='text-2xl font-semibold'><LocalizedText text={"空间成员"} /></h1>
        <p className='mt-1 text-sm text-muted-foreground'>
          <LocalizedText text={"\n          成员必须是所属租户的 active 成员。租户成员不会自动加入所有空间。\n        "} /></p>
      </header>
      {canEdit && (
        <section className={`${panel} space-y-3`}>
          <h2 className='font-semibold'><LocalizedText text={"添加或恢复成员"} /></h2>
          <p className='text-sm text-muted-foreground'><LocalizedText text={"输入现有全局账号 ID；API 会校验其当前租户成员资格。"} /></p>
          <Button onClick={() => { setError(''); setTargetId(''); setTargetRole('member'); setAddOpen(true) }}><LocalizedText text='加入空间' /></Button>
          <FormDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            title={<LocalizedText text='添加或恢复成员' />}
            formAriaLabel='添加或恢复成员'
            description={<LocalizedText text='输入现有全局账号 ID，并为其选择 Workspace 角色。' />}
            error={error}
            submitLabel={<LocalizedText text='加入空间' />}
            pending={changeRole.isPending}
            disabled={!/^\d+$/.test(targetId)}
            onSubmit={() => changeRole.mutate({ userId: targetId, workspace_role: targetRole })}
            onCancel={() => setAddOpen(false)}
          >
            <div className='space-y-3'>
              <div className='space-y-2'>
                <Label htmlFor='workspace-member-id'><LocalizedText text='用户 ID' /></Label>
                <Input id='workspace-member-id' autoFocus inputMode='numeric' pattern='[0-9]+' value={targetId} onChange={(event) => setTargetId(event.target.value)} />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='workspace-member-role'><LocalizedText text='角色' /></Label>
                <LocalizedNativeSelect id='workspace-member-role' className='h-10 w-full rounded-md border bg-background px-3 text-sm' value={targetRole} onChange={(event) => setTargetRole(event.target.value as WorkspaceRole)}>
                  <option value='member'><LocalizedText text='成员' /></option>
                  <option value='viewer'><LocalizedText text='只读成员' /></option>
                  <option value='admin'><LocalizedText text='管理员' /></option>
                  {isOwner && <option value='owner'><LocalizedText text='所有者' /></option>}
                </LocalizedNativeSelect>
              </div>
            </div>
          </FormDialog>
        </section>
      )}
      <section className={panel}>
        <h2 className='font-semibold'><LocalizedText text={"成员列表"} /></h2>
        {members.isLoading ? (
          <p className='py-5 text-sm text-muted-foreground'><LocalizedText text={"正在加载…"} /></p>
        ) : members.isError ? (
          <p role='alert' className='py-5 text-sm text-destructive'>
            {members.error.message}
          </p>
        ) : members.data?.items.length ? (
          <div className='mt-3 overflow-x-auto'>
            <table className='w-full text-left text-sm'>
              <thead>
                <tr className='border-b text-muted-foreground'>
                  <th className='p-3'><LocalizedText text={"成员"} /></th>
                  <th className='p-3'><LocalizedText text={"用户 ID"} /></th>
                  <th className='p-3'><LocalizedText text={"角色"} /></th>
                  <th className='p-3'><LocalizedText text={"状态"} /></th>
                  {canManage && <th className='p-3'><LocalizedText text={"操作"} /></th>}
                </tr>
              </thead>
              <tbody>
                {members.data.items.map((member) => {
                  const isTargetOwner = member.workspace_role === 'owner'
                  const protectedOwner = isTargetOwner && !isOwner
                  return (
                    <tr key={member.user_id} className='border-b last:border-0'>
                      <td className='p-3'>
                        {member.nick_name || member.user_name}
                        {member.email && (
                          <span className='block text-muted-foreground'>
                            {member.email}
                          </span>
                        )}
                      </td>
                      <td className='p-3'>{member.user_id}</td>
                      <td className='p-3'>
                        {canEdit &&
                        !protectedOwner &&
                        member.status === 'active' ? (
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => setRoleTarget({ member, role: member.workspace_role })}
                          >
                            {roleLabel[member.workspace_role]}
                          </Button>
                        ) : (
                          roleLabel[member.workspace_role]
                        )}
                      </td>
                      <td className='p-3'>
                        {member.status === 'active' ? <LocalizedText text={"有效"} /> : member.status === 'removed' ? <LocalizedText text={"已移除"} /> : member.status}
                      </td>
                      {canManage && (
                        <td className='space-x-3 p-3'>
                          {workspace.status === 'archived' ? (
                            '归档空间只读'
                          ) : protectedOwner ? (
                            '管理员不能操作所有者'
                          ) : member.status === 'active' ? (
                            <button
                              className='underline'
                              onClick={() => { setError(''); setActionTarget({ kind: 'remove', member }) }}
                            >
                              <LocalizedText text={"\n                              移除\n                            "} /></button>
                          ) : (
                            workspace.status === 'active' && (
                              <button
                                className='underline'
                                onClick={() => { setError(''); setActionTarget({ kind: 'rejoin', member }) }}
                              >
                                <LocalizedText text={"\n                                重新加入\n                              "} /></button>
                            )
                          )}
                          {isOwner &&
                            member.status === 'active' &&
                            !isTargetOwner &&
                            workspace.status === 'active' && (
                              <button
                                className='ml-3 underline'
                                onClick={() => { setError(''); setTransferTarget(member); setNewOwnerId(member.user_id); setTransferOpen(true) }}
                              >
                                <LocalizedText text={"\n                                转移所有权\n                              "} /></button>
                            )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className='mt-4 flex items-center justify-between text-sm'>
              <span><LocalizedText text={"共 "} />{members.data.total} <LocalizedText text={" 人"} /></span>
              <div className='flex gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  <LocalizedText text={"\n                  上一页\n                "} /></Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={page * 20 >= members.data.total}
                  onClick={() => setPage((value) => value + 1)}
                >
                  <LocalizedText text={"\n                  下一页\n                "} /></Button>
              </div>
            </div>
          </div>
        ) : (
          <p className='py-5 text-center text-sm text-muted-foreground'>
            <LocalizedText text={"\n            暂无成员\n          "} /></p>
        )}
      </section>
      {isOwner && workspace.status === 'active' && (
        <section className={`${panel} max-w-xl space-y-3`}>
          <h2 className='font-semibold'><LocalizedText text={"转移空间所有权"} /></h2>
          <p className='text-sm text-muted-foreground'>
            <LocalizedText text={"\n            新所有者必须已经是该空间的 active 成员。转移完成后你会成为管理员。\n          "} /></p>
          <Button variant='outline' onClick={() => { setError(''); setTransferTarget(null); setNewOwnerId(''); setTransferOpen(true) }}>
            <LocalizedText text='选择新所有者' />
          </Button>
          <FormDialog
            open={transferOpen}
            onOpenChange={setTransferOpen}
            title={<LocalizedText text='转移空间所有权' />}
            formAriaLabel='转移空间所有权'
            description={<LocalizedText text='新所有者必须已经是该 Workspace 的 active 成员；转移后你会成为管理员。' />}
            error={error}
            submitLabel={<LocalizedText text='确认转移' />}
            pending={transfer.isPending}
            disabled={!/^\d+$/.test(newOwnerId) || newOwnerId === String(actorId)}
            onSubmit={() => transfer.mutate(newOwnerId)}
            onCancel={() => setTransferOpen(false)}
          >
            <div className='space-y-2'>
              <Label htmlFor='new-owner-id'><LocalizedText text='新所有者用户 ID' /></Label>
              <Input id='new-owner-id' autoFocus inputMode='numeric' pattern='[0-9]+' value={newOwnerId} onChange={(event) => setNewOwnerId(event.target.value)} />
              {transferTarget && <p className='text-xs text-muted-foreground'>{transferTarget.nick_name || transferTarget.user_name}</p>}
            </div>
          </FormDialog>
        </section>
      )}
      {error && (
        <p role='alert' className='text-sm text-destructive'>
          {error}
        </p>
      )}
      <Dialog open={Boolean(roleTarget)} onOpenChange={(open) => { if (!open && !changeRole.isPending) setRoleTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle><LocalizedText text='编辑空间角色' /></DialogTitle>
            <DialogDescription>{roleTarget?.member.nick_name || roleTarget?.member.user_name}</DialogDescription>
          </DialogHeader>
          {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
          <div className='space-y-2'>
            <Label htmlFor='workspace-role-edit'><LocalizedText text='角色' /></Label>
            <LocalizedNativeSelect id='workspace-role-edit' className='h-10 w-full rounded-md border bg-background px-3 text-sm' value={roleTarget?.role ?? 'member'} onChange={(event) => setRoleTarget((current) => current ? { ...current, role: event.target.value as WorkspaceRole } : current)}>
              <option value='member'><LocalizedText text='成员' /></option>
              <option value='viewer'><LocalizedText text='只读成员' /></option>
              <option value='admin'><LocalizedText text='管理员' /></option>
              {isOwner && <option value='owner'><LocalizedText text='所有者' /></option>}
            </LocalizedNativeSelect>
          </div>
          <DialogFooter>
            <Button variant='outline' disabled={changeRole.isPending} onClick={() => setRoleTarget(null)}><LocalizedText text='取消' /></Button>
            <Button disabled={!roleTarget || changeRole.isPending} onClick={() => roleTarget && changeRole.mutate({ userId: roleTarget.member.user_id, workspace_role: roleTarget.role })}>{changeRole.isPending ? <LocalizedText text='保存中…' /> : <LocalizedText text='保存角色' />}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(actionTarget)}
        onOpenChange={(open) => { if (!open && !remove.isPending && !changeRole.isPending) setActionTarget(null) }}
        title={actionTarget?.kind === 'remove' ? '移除空间成员' : '重新加入空间'}
        desc={actionTarget?.kind === 'remove' ? '移除后成员不能访问当前 Workspace，但租户成员关系不会改变。' : '确认将该成员恢复为 active 状态并加入当前 Workspace？'}
        confirmText={actionTarget?.kind === 'remove' ? '确认移除' : '确认加入'}
        destructive={actionTarget?.kind === 'remove'}
        isLoading={remove.isPending || changeRole.isPending}
        handleConfirm={() => {
          if (!actionTarget) return
          if (actionTarget.kind === 'remove') {
            remove.mutate(actionTarget.member.user_id, { onSuccess: () => setActionTarget(null) })
          } else {
            changeRole.mutate({
              userId: actionTarget.member.user_id,
              workspace_role: actionTarget.member.workspace_role === 'owner' && !isOwner ? 'member' : actionTarget.member.workspace_role,
            }, { onSuccess: () => setActionTarget(null) })
          }
        }}
      >
        {actionTarget && <p className='text-sm font-medium'>{actionTarget.member.nick_name || actionTarget.member.user_name}</p>}
        {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
      </ConfirmDialog>
    </main>
  )
}

function NoPermission() {
  return (
    <main className='space-y-3 p-6'>
      <h1 className='text-xl font-semibold'><LocalizedText text={"没有管理权限"} /></h1>
      <p className='text-sm text-muted-foreground'>
        <LocalizedText text={"\n        当前 Workspace 角色无权管理此页面。\n      "} /></p>
    </main>
  )
}
