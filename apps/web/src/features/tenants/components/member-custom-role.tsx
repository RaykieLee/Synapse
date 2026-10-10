import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Member } from '@/api/tenants'
import { ApiProblem, api } from '@/lib/api'
import type { TenantRoleRecord } from '../types'

function errorText(error: unknown) {
  if (error instanceof ApiProblem)
    return `${error.message}${error.code ? `（${error.code}）` : ''}`
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}

export function MemberCustomRoleCell({
  tenantId,
  actorId,
  member,
  roles,
  rolesLoading,
  rolesError,
  membershipVersion,
  canManage,
  onError,
}: {
  tenantId: string
  actorId: string
  member: Member
  roles: TenantRoleRecord[]
  rolesLoading: boolean
  rolesError?: string
  membershipVersion: number
  canManage: boolean
  onError: (message: string) => void
}) {
  const client = useQueryClient()
  const canAssign =
    member.status === 'active' && member.tenant_role === 'member'
  const assignment = useQuery({
    queryKey: [
      'synapse',
      actorId,
      tenantId,
      'personal',
      'member-custom-role',
      membershipVersion,
      member.user_id,
    ],
    enabled: canAssign,
    queryFn: () =>
      api<{ user_id: string; role: TenantRoleRecord | null }>(
        `/tenants/${tenantId}/members/${member.user_id}/custom-role`
      ),
  })
  const invalidate = async () => {
    await client.invalidateQueries({
      queryKey: [
        'synapse',
        actorId,
        tenantId,
        'personal',
        'member-custom-role',
      ],
    })
    await client.invalidateQueries({
      queryKey: ['synapse', actorId, tenantId, 'personal', 'tenant-members'],
    })
    await client.invalidateQueries({
      queryKey: ['synapse', actorId, tenantId, 'personal', 'tenant'],
    })
  }
  const assign = useMutation({
    mutationFn: (roleId: string) =>
      api<{ user_id: string; role: TenantRoleRecord | null }>(
        `/tenants/${tenantId}/members/${member.user_id}/custom-role`,
        { method: 'PUT', body: JSON.stringify({ role_id: roleId }) }
      ),
    onSuccess: async () => {
      onError('')
      await invalidate()
    },
    onError: (cause) => onError(errorText(cause)),
  })
  const revoke = useMutation({
    mutationFn: () =>
      api<void>(`/tenants/${tenantId}/members/${member.user_id}/custom-role`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      onError('')
      await invalidate()
    },
    onError: (cause) => onError(errorText(cause)),
  })

  if (!canAssign)
    return <span className='text-xs text-muted-foreground'>—</span>
  if (canManage && !canAssign) {
    return <span className='text-xs text-muted-foreground'>需成员角色</span>
  }
  if (assignment.isLoading || (canManage && rolesLoading)) {
    return <span className='text-xs text-muted-foreground'>加载中…</span>
  }
  if (assignment.isError) {
    return (
      <span role='alert' className='text-xs text-destructive'>
        读取失败：{errorText(assignment.error)}
      </span>
    )
  }
  if (canManage && rolesError) {
    return (
      <span role='alert' className='text-xs text-destructive'>
        角色列表加载失败：{rolesError}
      </span>
    )
  }
  if (!canManage) {
    return (
      <span className='text-xs'>
        {assignment.data?.role?.role_name ?? '未分配'}
      </span>
    )
  }

  const selected = assignment.data?.role?.role_id ?? ''
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <select
        aria-label={`${member.user_name}自定义角色`}
        className='h-8 max-w-44 rounded-md border bg-background px-2 text-xs shadow-xs'
        value={selected}
        disabled={assign.isPending || revoke.isPending}
        onChange={(event) => {
          if (event.target.value) assign.mutate(event.target.value)
        }}
      >
        <option value=''>
          {assignment.data?.role ? '选择其他角色…' : '未分配'}
        </option>
        {roles.map((role) => (
          <option key={role.role_id} value={role.role_id}>
            {role.role_name}
          </option>
        ))}
      </select>
      {assignment.data?.role ? (
        <button
          type='button'
          className='text-xs text-destructive underline-offset-4 hover:underline disabled:opacity-50'
          disabled={assign.isPending || revoke.isPending}
          onClick={() => revoke.mutate()}
        >
          撤销
        </button>
      ) : null}
      {assign.isPending || revoke.isPending ? (
        <span className='text-xs text-muted-foreground'>保存中…</span>
      ) : null}
    </div>
  )
}
