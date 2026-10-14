import { api } from '@/lib/api'

export type TenantMenu = {
  menu_id: string
  tenant_id: string
  menu_name: string
  parent_id: string | null
  order_num: number
  path: string
  component: string | null
  query: string | null
  is_frame: number
  is_cache: number
  menu_type: 'M' | 'C' | 'F'
  visible: '0' | '1'
  status: '0' | '1'
  perms: string | null
  icon: string
  remark: string | null
  children: TenantMenu[]
}

export type TenantMenuTree = {
  items: TenantMenu[]
}

export type TenantMenuPayload = Omit<
  TenantMenu,
  'menu_id' | 'tenant_id' | 'children'
>

export type TenantMenuOrder = {
  menu_id: string
  parent_id: string | null
  order_num: number
}

export function getTenantMenuTree(tenantId: string) {
  return api<TenantMenuTree>(
    `/tenants/${tenantId}/menus/tree?include_disabled=true`
  )
}

export function createTenantMenu(tenantId: string, payload: TenantMenuPayload) {
  return api<TenantMenu>(`/tenants/${tenantId}/menus`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateTenantMenu(
  tenantId: string,
  menuId: string,
  payload: Partial<TenantMenuPayload>
) {
  return api<TenantMenu>(`/tenants/${tenantId}/menus/${menuId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function reorderTenantMenus(tenantId: string, items: TenantMenuOrder[]) {
  return api<{ updated: number }>(`/tenants/${tenantId}/menus/reorder`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  })
}

export function deleteTenantMenu(tenantId: string, menuId: string) {
  return api<void>(`/tenants/${tenantId}/menus/${menuId}`, {
    method: 'DELETE',
  })
}
