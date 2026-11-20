import { api } from '@/lib/api'
import type { components } from '@/api/generated/openapi'

export type TenantStatus = 'active' | 'suspended' | 'archived'
export type TenantValidity = 'current' | 'not_started' | 'expired' | 'unlimited'
export type TenantRole = 'owner' | 'admin' | 'member'
export type MemberStatus = 'active' | 'suspended' | 'removed'
export type MemberRole = TenantRole

export type Tenant = Omit<
  components['schemas']['TenantResponse'],
  'status' | 'tenant_role'
> & { status: TenantStatus; tenant_role: TenantRole | null }

export type TenantListItem = Omit<
  components['schemas']['TenantWithWorkspacesResponse'],
  'status' | 'tenant_role'
> & { status: TenantStatus; tenant_role: TenantRole | null }

export type Member = Omit<
  components['schemas']['MemberResponse'],
  'status' | 'tenant_role'
> & { status: MemberStatus; tenant_role: MemberRole }

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
  q?: string
  status?: TenantStatus
  validity?: TenantValidity
  slug?: string
  createdFrom?: string
  createdTo?: string
  updatedFrom?: string
  expiresBefore?: string
}

export type TenantPage = Omit<
  components['schemas']['TenantPageResponse'],
  'items'
> & { items: TenantListItem[] }

export type PlatformTenantPage = Omit<
  components['schemas']['PlatformTenantPageResponse'],
  'items'
> & { items: Tenant[] }

export type MemberPage = Omit<
  components['schemas']['MemberPageResponse'],
  'items'
> & { items: Member[] }

export type TenantCreatePayload = components['schemas']['TenantCreate']

export type TenantCreated = components['schemas']['TenantCreatedResponse']

export type TenantPatchPayload = Omit<
  components['schemas']['TenantPatch'],
  'status'
> & { status?: TenantStatus }

export type MemberCreatePayload = Omit<
  components['schemas']['MemberCreate'],
  'tenant_role'
> & { tenant_role?: MemberRole }

export type MemberPatchPayload = Omit<
  components['schemas']['MemberPatch'],
  'tenant_role' | 'status'
> & { tenant_role?: MemberRole; status?: MemberStatus }

function withQuery(
  path: string,
  params: Record<string, string | number | undefined>
) {
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
    q: params.q,
    status: params.status,
    validity: params.validity,
    slug: params.slug,
    created_from: params.createdFrom,
    created_to: params.createdTo,
    updated_from: params.updatedFrom,
    expires_before: params.expiresBefore,
  })
}

export function listTenants(params: TenantListParams = {}) {
  return api<TenantPage>(`/tenants${toTenantQuery(params)}`)
}

export function listPlatformTenants(params: TenantListParams = {}) {
  return api<PlatformTenantPage>(`/platform/tenants${toTenantQuery(params)}`)
}

export function getTenant(tenantId: string) {
  return api<Tenant>(`/tenants/${tenantId}`)
}

export function createTenant(payload: TenantCreatePayload) {
  return api<TenantCreated>('/tenants', {
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
  params: { page?: number; pageSize?: number } = {}
) {
  return api<MemberPage>(
    withQuery(`/tenants/${tenantId}/members`, {
      page: params.page,
      page_size: params.pageSize,
    })
  )
}

export function createTenantMember(
  tenantId: string,
  payload: MemberCreatePayload
) {
  return api<Member>(`/tenants/${tenantId}/members`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateTenantMember(
  tenantId: string,
  userId: string,
  payload: MemberPatchPayload
) {
  return api<Member>(`/tenants/${tenantId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}
