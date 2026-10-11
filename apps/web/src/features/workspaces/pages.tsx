import * as React from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { formatMessage } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  listWorkspaceMembers,
  putWorkspaceMember,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
  updateWorkspace,
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
        <Link
          className='text-sm underline underline-offset-4'
          to='/w/$workspaceId'
          params={{ workspaceId: workspace.workspace_id }}
        >
          <LocalizedText text={"\n          ← 返回空间\n        "} /></Link>
        <p className='mt-3 text-sm text-muted-foreground'><LocalizedText text={"Workspace 设置"} /></p>
        <h1 className='text-2xl font-semibold'>{workspace.name}</h1>
      </header>
      <section className={`${panel} max-w-2xl space-y-4`}>
        <h2 className='font-semibold'><LocalizedText text={"基本信息"} /></h2>
        <div className='space-y-2'>
          <Label htmlFor='workspace-name-edit'><LocalizedText text={"名称"} /></Label>
          <Input
            id='workspace-name-edit'
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='workspace-icon-edit'><LocalizedText text={"图标标识（可选）"} /></Label>
          <Input
            id='workspace-icon-edit'
            value={icon}
            onChange={(event) => setIcon(event.target.value)}
            maxLength={64}
          />
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
        <Button
          disabled={!name.trim() || update.isPending}
          onClick={() =>
            update.mutate({ name: name.trim(), icon: icon.trim() || null })
          }
        >
          {update.isPending ? <LocalizedText text={"保存中…"} /> : <LocalizedText text={"保存设置"} />}
        </Button>
      </section>
      <section className={`${panel} max-w-2xl`}>
        <h2 className='font-semibold'><LocalizedText text={"归档空间"} /></h2>
        <p className='mt-1 text-sm text-muted-foreground'>
          <LocalizedText text={"\n          归档后空间不会出现在普通空间列表中，成员关系和资源保留。所有者或管理员可以从切换器的管理列表恢复。\n        "} /></p>
        <Button
          className='mt-4'
          variant={workspace.status === 'active' ? "destructive" : "default"}
          disabled={setStatus.isPending}
          onClick={() => {
            if (
              workspace.status === 'active' &&
              !window.confirm(formatMessage('确定归档“{name}”吗？', { name: workspace.name }))
            )
              return
            setStatus.mutate(
              workspace.status === 'active' ? 'archived' : 'active'
            )
          }}
        >
          {workspace.status === 'active' ? <LocalizedText text={"归档空间"} /> : <LocalizedText text={"恢复空间"} />}
        </Button>
      </section>
      {error && (
        <p role='alert' className='text-sm text-destructive'>
          {error}
        </p>
      )}
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
      await refresh()
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : '所有权转移失败'),
  })
  if (workspace.status === 'archived' && !canManage) return <NoPermission />
  return (
    <main className='space-y-6 p-6'>
      <header>
        <Link
          className='text-sm underline underline-offset-4'
          to='/w/$workspaceId'
          params={{ workspaceId: workspace.workspace_id }}
        >
          <LocalizedText text={"\n          ← 返回空间\n        "} /></Link>
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
          <p className='text-sm text-muted-foreground'>
            <LocalizedText text={"\n            输入现有全局账号 ID；API 会校验其当前租户成员资格。\n          "} /></p>
          <div className='flex flex-wrap items-end gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='workspace-member-id'><LocalizedText text={"用户 ID"} /></Label>
              <Input
                id='workspace-member-id'
                inputMode='numeric'
                pattern='[0-9]+'
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
                className='w-48'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='workspace-member-role'><LocalizedText text={"角色"} /></Label>
              <LocalizedNativeSelect
                id='workspace-member-role'
                className='h-9 rounded-md border bg-background px-3 text-sm'
                value={targetRole}
                onChange={(event) =>
                  setTargetRole(event.target.value as WorkspaceRole)
                }
              >
                <option value='member'><LocalizedText text={"成员"} /></option>
                <option value='viewer'><LocalizedText text={"只读成员"} /></option>
                <option value='admin'><LocalizedText text={"管理员"} /></option>
                {isOwner && <option value='owner'><LocalizedText text={"所有者"} /></option>}
              </LocalizedNativeSelect>
            </div>
            <Button
              disabled={!/^\d+$/.test(targetId) || changeRole.isPending}
              onClick={() =>
                changeRole.mutate({
                  userId: targetId,
                  workspace_role: targetRole,
                })
              }
            >
              {changeRole.isPending ? <LocalizedText text={"保存中…"} /> : <LocalizedText text={"加入空间"} />}
            </Button>
          </div>
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
                          <LocalizedNativeSelect
                            aria-label={`${member.user_name} 空间角色`}
                            className='rounded border bg-background p-1'
                            value={member.workspace_role}
                            onChange={(event) =>
                              changeRole.mutate({
                                userId: member.user_id,
                                workspace_role: event.target
                                  .value as WorkspaceRole,
                              })
                            }
                          >
                            <option value='member'><LocalizedText text={"成员"} /></option>
                            <option value='viewer'><LocalizedText text={"只读成员"} /></option>
                            <option value='admin'><LocalizedText text={"管理员"} /></option>
                            {isOwner && <option value='owner'><LocalizedText text={"所有者"} /></option>}
                          </LocalizedNativeSelect>
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
                              onClick={() => {
                                if (
                                  window.confirm(
                                    formatMessage('确定从空间移除“{name}”吗？', { name: member.nick_name || member.user_name })
                                  )
                                )
                                  remove.mutate(member.user_id)
                              }}
                            >
                              <LocalizedText text={"\n                              移除\n                            "} /></button>
                          ) : (
                            workspace.status === 'active' && (
                              <button
                                className='underline'
                                onClick={() =>
                                  changeRole.mutate({
                                    userId: member.user_id,
                                    workspace_role:
                                      member.workspace_role === 'owner' &&
                                      !isOwner
                                        ? 'member'
                                        : member.workspace_role,
                                  })
                                }
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
                                onClick={() => {
                                  setNewOwnerId(member.user_id)
                                  if (
                                    window.confirm(
                                      formatMessage('将空间所有权转交给“{name}”？你将变为空间管理员。', { name: member.nick_name || member.user_name })
                                    )
                                  )
                                    transfer.mutate(member.user_id)
                                }}
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
          <div className='flex items-end gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='new-owner-id'><LocalizedText text={"新所有者用户 ID"} /></Label>
              <Input
                id='new-owner-id'
                inputMode='numeric'
                pattern='[0-9]+'
                value={newOwnerId}
                onChange={(event) => setNewOwnerId(event.target.value)}
              />
            </div>
            <Button
              variant='outline'
              disabled={!/^\d+$/.test(newOwnerId) || transfer.isPending}
              onClick={() => {
                if (window.confirm(formatMessage('确认转移空间所有权？', {})))
                  transfer.mutate(newOwnerId)
              }}
            >
              {transfer.isPending ? <LocalizedText text={"转移中…"} /> : <LocalizedText text={"确认转移"} />}
            </Button>
          </div>
        </section>
      )}
      {error && (
        <p role='alert' className='text-sm text-destructive'>
          {error}
        </p>
      )}
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
