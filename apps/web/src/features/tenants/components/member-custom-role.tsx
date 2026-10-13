import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { Button } from '@/components/ui/button'
import { FormDialog } from '@/components/form-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { Member } from '@/api/tenants'
import { ApiProblem, api } from '@/lib/api'
import type { TenantRoleRecord } from '../types'
import { LocalizedText } from '@/components/localized-text'
import { useLocale, useLocaleText } from '@/lib/i18n'

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
  const locale = useLocale()
  const t = useLocaleText()
  const client = useQueryClient()
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editorError, setEditorError] = React.useState('')
  const [roleId, setRoleId] = React.useState('')
  const [revokeOpen, setRevokeOpen] = React.useState(false)
  const [revokeError, setRevokeError] = React.useState('')
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
      setEditorError('')
      onError('')
      await invalidate()
    },
    onError: (cause) => {
      const message = errorText(cause)
      setEditorError(message)
      onError(message)
    },
  })
  const revoke = useMutation({
    mutationFn: () =>
      api<void>(`/tenants/${tenantId}/members/${member.user_id}/custom-role`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      setRevokeError('')
      setRevokeOpen(false)
      onError('')
      await invalidate()
    },
    onError: (cause) => {
      const message = errorText(cause)
      setRevokeError(message)
      onError(message)
    },
  })

  if (!canAssign) {
    const reason =
      member.status !== 'active'
        ? locale === 'en'
          ? 'Inactive members cannot be assigned a custom role.'
          : '成员非 active 状态，无法分配自定义角色。'
        : locale === 'en'
          ? 'Tenant owner and admin identities are protected and cannot be assigned a custom role.'
          : '租户 owner 和 admin 身份受保护，不能分配自定义角色。'
    return <span className='text-xs text-muted-foreground'>{reason}</span>
  }
  if (assignment.isLoading || (canManage && rolesLoading)) {
    return <span className='text-xs text-muted-foreground'><LocalizedText text={"加载中…"} /></span>
  }
  if (assignment.isError) {
    return (
      <span role='alert' className='text-xs text-destructive'>
        <LocalizedText text={"\n        读取失败："} />{errorText(assignment.error)}
      </span>
    )
  }
  if (canManage && rolesError) {
    return (
      <span role='alert' className='text-xs text-destructive'>
        <LocalizedText text={"\n        角色列表加载失败："} />{rolesError}
      </span>
    )
  }
  if (!canManage) {
    return (
      <span className='text-xs'>
        {assignment.data?.role?.role_name ?? t('未分配')}
      </span>
    )
  }

  const selected = assignment.data?.role?.role_id ?? ''
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Button
        variant='ghost'
        size='sm'
        className='h-8 px-2 text-xs'
        disabled={assign.isPending || revoke.isPending}
        onClick={() => {
          setEditorError('')
          setRoleId(selected)
          setEditorOpen(true)
        }}
      >
        {assignment.data?.role?.role_name ?? t('未分配')}
      </Button>
      {assignment.data?.role ? (
        <button
          type='button'
          className='text-xs text-destructive underline-offset-4 hover:underline disabled:opacity-50'
          disabled={assign.isPending || revoke.isPending}
          onClick={() => {
            setRevokeError('')
            setRevokeOpen(true)
          }}
        >
          <LocalizedText text={'撤销'} />
        </button>
      ) : null}
      {assign.isPending || revoke.isPending ? (
        <span className='text-xs text-muted-foreground'><LocalizedText text={"保存中…"} /></span>
      ) : null}
      <FormDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        title={<LocalizedText text={'编辑自定义角色'} />}
        formAriaLabel='编辑自定义角色'
        description='为普通成员分配租户自定义角色；保存后权限立即生效。'
        error={editorError}
        submitLabel={<LocalizedText text={'保存角色'} />}
        pending={assign.isPending}
        disabled={!roleId}
        onSubmit={() => {
          if (roleId) assign.mutate(roleId, { onSuccess: () => setEditorOpen(false) })
        }}
        onCancel={() => { setEditorOpen(false); setEditorError('') }}
      >
        <div className='space-y-2'>
          <label className='text-sm' htmlFor={`custom-role-${member.user_id}`}>
            <LocalizedText text={'自定义角色'} />
          </label>
          <LocalizedNativeSelect
            id={`custom-role-${member.user_id}`}
            className='h-10 w-full rounded-md border bg-background px-3 text-sm'
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
          >
            <option value=''>{assignment.data?.role ? t('选择其他角色…') : t('未分配')}</option>
            {roles.map((role) => (
              <option key={role.role_id} value={role.role_id}>
                {role.role_name}
              </option>
            ))}
          </LocalizedNativeSelect>
        </div>
      </FormDialog>
      <AlertDialog
        open={revokeOpen}
        onOpenChange={(open) => {
          if (revoke.isPending) return
          setRevokeOpen(open)
          if (!open) setRevokeError('')
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle><LocalizedText text={'撤销自定义角色'} /></AlertDialogTitle>
            <AlertDialogDescription>
              <LocalizedText text={'撤销后该成员的自定义角色权限会立即失效。确定继续吗？'} />
            </AlertDialogDescription>
          </AlertDialogHeader>
          {revokeError && (
            <p role='alert' className='text-sm text-destructive'>
              {revokeError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>
              <LocalizedText text={'取消'} />
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={revoke.isPending}
              onClick={(event) => {
                event.preventDefault()
                setRevokeError('')
                revoke.mutate()
              }}
            >
              {revoke.isPending ? (
                <LocalizedText text={'处理中…'} />
              ) : (
                <LocalizedText text={'确认撤销'} />
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
