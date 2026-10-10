import { api } from '@/lib/api'

export type TenantStatus = 'active' | 'suspended' | 'archived'
export type TenantRole = 'owner' | 'admin' | 'member'
export type MemberStatus = 'active' | 'suspended' | 'removed'
export type MemberRole = TenantRole

export type Tenant = {
  tenant_id: string
  slug: string
  name: string
  status: TenantStatus
  valid_from: string | null
  valid_until: string | null
  settings: Record<string, unknown>
  tenant_role: TenantRole | null
  membership_version: number
  created_at: string
  updated_at: string
}

export type Member = {
  user_id: string
  user_name: string
  nick_name: string | null
  email: string | null
  status: MemberStatus
  tenant_role: MemberRole
  joined_at: string | null
  created_at: string
  updated_at: string
}

export type Page<T> = {
  items: T[]
  total: number
  page: number
  page_size: number
}

export type TenantListParams = {
  page?: number
  pageSize?: number
  name?: string
  status?: TenantStatus
}

export type TenantCreatePayload = {
  slug: string
  name: string
  first_owner_user_id: string
  valid_from?: string | null
  valid_until?: string | null
}

export type TenantPatchPayload = {
  name?: string
  status?: TenantStatus
  settings?: Record<string, unknown>
  valid_from?: string | null
  valid_until?: string | null
}

export type MemberCreatePayload = {
  user_id: string
  tenant_role?: MemberRole
}

export type MemberPatchPayload = {
  tenant_role?: MemberRole
  status?: MemberStatus
}

function withQuery(path: string, params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

function toTenantQuery(params: TenantListParams) {
  return withQuery('', {
    page: params.page,
    page_size: params.pageSize,
    name: params.name,
    status: params.status,
  })
}

export function listTenants(params: TenantListParams = {}) {
  return api<Page<Tenant>>(`/tenants${toTenantQuery(params)}`)
}

export function listPlatformTenants(params: TenantListParams = {}) {
  return api<Page<Tenant>>(`/platform/tenants${toTenantQuery(params)}`)
}

export function getTenant(tenantId: string) {
  return api<Tenant>(`/tenants/${tenantId}`)
}

export function createTenant(payload: TenantCreatePayload) {
  return api<Tenant>('/tenants', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateTenant(tenantId: string, payload: TenantPatchPayload) {
  return api<Tenant>(`/tenants/${tenantId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function listTenantMembers(
  tenantId: string,
  params: { page?: number; pageSize?: number } = {},
) {
  return api<Page<Member>>(
    withQuery(`/tenants/${tenantId}/members`, {
      page: params.page,
      page_size: params.pageSize,
    }),
  )
}

export function createTenantMember(tenantId: string, payload: MemberCreatePayload) {
  return api<Member>(`/tenants/${tenantId}/members`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateTenantMember(
  tenantId: string,
  userId: string,
  payload: MemberPatchPayload,
) {
  return api<Member>(`/tenants/${tenantId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}
