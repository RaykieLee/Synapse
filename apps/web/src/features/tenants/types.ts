import { getLocale, type Locale } from '@/lib/i18n'

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

export type {
  CreatedTenantInvitation,
  TenantInvitation,
  TenantInvitationCreatePayload,
  TenantInvitationRole,
} from '@/api/tenant-invitations'

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

const tenantTextEn: Record<keyof typeof tenantText, string> = {
  active: 'Active',
  suspended: 'Suspended',
  archived: 'Archived',
  invited: 'Invited',
  removed: 'Removed',
  owner: 'Owner',
  admin: 'Administrator',
  member: 'Member',
}

export function localizedTenantText(
  key: keyof typeof tenantText,
  locale: Locale = getLocale()
) {
  return locale === 'en' ? tenantTextEn[key] : tenantText[key]
}

function dateLocale(locale: Locale) {
  return locale === 'en' ? 'en-US' : 'zh-CN'
}

export function formatDateTime(
  value: string | null | undefined,
  locale: Locale = getLocale()
) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(dateLocale(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatDateRange(
  from: string | null | undefined,
  until: string | null | undefined,
  locale: Locale = getLocale()
) {
  const formatter = new Intl.DateTimeFormat(dateLocale(locale))
  const unlimited = locale === 'en' ? 'Unlimited' : '不限'
  if (!from && !until) return locale === 'en' ? 'Unlimited' : '长期有效'
  const fromText = from ? formatter.format(new Date(from)) : unlimited
  const untilText = until ? formatter.format(new Date(until)) : unlimited
  return `${fromText} ~ ${untilText}`
}
