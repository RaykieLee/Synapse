import { api } from '@/lib/api'

export type TenantConfigStatus = '0' | '1'

export type TenantConfig = {
  config_id: string
  tenant_id: string
  config_name: string
  config_key: string
  config_value: string | null
  value_redacted: boolean
  group_name: string
  is_frontend: boolean
  is_sensitive: boolean
  status: TenantConfigStatus
  remark: string | null
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

export type PublicTenantConfig = {
  key: string
  value: string
  group: string
}

export type TenantConfigPage = {
  items: TenantConfig[]
  total: number
  page: number
  page_size: number
}

export type TenantConfigListParams = {
  page?: number
  pageSize?: number
  configName?: string
  configKey?: string
  groupName?: string
  status?: TenantConfigStatus
  isSensitive?: boolean
}

export type TenantConfigCreatePayload = {
  config_name: string
  config_key: string
  config_value: string
  group_name?: string
  is_frontend?: boolean
  is_sensitive?: boolean
  status?: TenantConfigStatus
  remark?: string | null
}

export type TenantConfigPatchPayload = Partial<TenantConfigCreatePayload>

function withQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined>
) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

export function listPublicTenantConfigs(tenantId: string) {
  return api<{ tenant_id: string; items: PublicTenantConfig[] }>(
    `/tenants/${tenantId}/configs/public`
  )
}

export function listTenantConfigs(
  tenantId: string,
  params: TenantConfigListParams = {}
) {
  return api<TenantConfigPage>(
    withQuery(`/tenants/${tenantId}/configs`, {
      page: params.page,
      page_size: params.pageSize,
      config_name: params.configName,
      config_key: params.configKey,
      group_name: params.groupName,
      status: params.status,
      is_sensitive: params.isSensitive,
    })
  )
}

export function createTenantConfig(
  tenantId: string,
  payload: TenantConfigCreatePayload
) {
  return api<TenantConfig>(`/tenants/${tenantId}/configs`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getTenantConfig(tenantId: string, configId: string) {
  return api<TenantConfig>(`/tenants/${tenantId}/configs/${configId}`)
}

export function updateTenantConfig(
  tenantId: string,
  configId: string,
  payload: TenantConfigPatchPayload
) {
  return api<TenantConfig>(`/tenants/${tenantId}/configs/${configId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteTenantConfig(tenantId: string, configId: string) {
  return api<void>(`/tenants/${tenantId}/configs/${configId}`, {
    method: 'DELETE',
  })
}
