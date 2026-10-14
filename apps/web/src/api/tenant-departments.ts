import { api } from '@/lib/api'

export type Department = {
  department_id: string
  tenant_id: string
  parent_id: string | null
  ancestors: string
  dept_name: string
  order_num: number
  leader: string | null
  phone: string | null
  email: string | null
  status: '0' | '1'
  children: Department[]
}

export type DepartmentTree = {
  items: Department[]
}

export type DepartmentPayload = {
  dept_name: string
  parent_id: string | null
  order_num: number
  leader: string
  phone: string
  email: string
  status: '0' | '1'
}

export type DepartmentOrder = {
  department_id: string
  parent_id: string | null
  order_num: number
}

export function getTenantDepartmentTree(tenantId: string) {
  return api<DepartmentTree>(
    `/tenants/${tenantId}/departments/tree?include_disabled=true`
  )
}

export function createTenantDepartment(
  tenantId: string,
  payload: DepartmentPayload
) {
  return api<Department>(`/tenants/${tenantId}/departments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateTenantDepartment(
  tenantId: string,
  departmentId: string,
  payload: Partial<DepartmentPayload>
) {
  return api<Department>(`/tenants/${tenantId}/departments/${departmentId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function reorderTenantDepartments(
  tenantId: string,
  items: DepartmentOrder[]
) {
  return api<{ updated: number }>(`/tenants/${tenantId}/departments/reorder`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  })
}

export function deleteTenantDepartment(tenantId: string, departmentId: string) {
  return api<void>(`/tenants/${tenantId}/departments/${departmentId}`, {
    method: 'DELETE',
  })
}
