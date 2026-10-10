export type TenantRoleRecord = {
  role_id: string
  tenant_id: string
  role_name: string
  role_key: string
  status: 'active' | 'disabled'
  permissions: string[]
}

export type MemberCustomRoleResponse = {
  user_id: string
  role: TenantRoleRecord | null
}

export type TenantInvitation = {
  invitation_id: string
  tenant_id: string
  email: string | null
  target_user_id: string | null
  tenant_role: 'admin' | 'member'
  status: string
  expired: boolean
  expires_at: string
  created_at: string
}

export type CreatedTenantInvitation = TenantInvitation & {
  token: string
  invite_link: string
}

export const tenantText = {
  active: '启用',
  suspended: '已停用',
  archived: '已归档',
  invited: '待加入',
  removed: '已移除',
  owner: '所有者',
  admin: '管理员',
  member: '成员',
} as const

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDateRange(
  from: string | null | undefined,
  until: string | null | undefined
) {
  const fromText = from ? new Date(from).toLocaleDateString('zh-CN') : '不限'
  const untilText = until ? new Date(until).toLocaleDateString('zh-CN') : '不限'
  return `${fromText} ~ ${untilText}`
}
