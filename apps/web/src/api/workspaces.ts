import { api } from '@/lib/api'

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer'
export type WorkspaceStatus = 'active' | 'archived'

export type Workspace = {
  workspace_id: string
  tenant_id: string
  slug: string
  name: string
  icon: string | null
  status: WorkspaceStatus
  settings?: Record<string, unknown>
  workspace_role: WorkspaceRole
  membership_version?: number
  created_at?: string
  updated_at?: string
}

export type WorkspaceMember = {
  user_id: string
  user_name: string
  nick_name: string | null
  email: string | null
  status: string
  workspace_role: WorkspaceRole
  joined_at: string | null
  created_at?: string
  updated_at?: string
}

export type Page<T> = {
  items: T[]
  total: number
  page: number
  page_size: number
}

export type WorkspaceCreatePayload = {
  slug: string
  name: string
  icon?: string | null
}

export type WorkspacePatchPayload = {
  name?: string
  icon?: string | null
  status?: WorkspaceStatus
  settings?: Record<string, unknown>
}

export type WorkspaceMembership = {
  user_id: string
  status: string
  workspace_role: WorkspaceRole
  membership_version: number
}

export type WorkspaceTransfer = {
  workspace_id: string
  previous_owner_user_id: string
  new_owner_user_id: string
  membership_version: number
}

export type WorkspaceListParams = {
  page?: number
  pageSize?: number
  tenantId?: string
  includeArchived?: boolean
}

const workspaceHeaders = (workspaceId: string) => ({
  'X-Workspace-ID': workspaceId,
})

function toWorkspaceQuery(params: WorkspaceListParams) {
  const query = new URLSearchParams()
  query.set('page', String(params.page ?? 1))
  query.set('page_size', String(params.pageSize ?? 20))
  if (params.tenantId) query.set('tenant_id', params.tenantId)
  if (params.includeArchived) query.set('include_archived', 'true')
  return query.toString()
}

export async function listWorkspaces(params: WorkspaceListParams = {}) {
  return api<Page<Workspace>>(`/workspaces?${toWorkspaceQuery(params)}`)
}

export async function listAllWorkspaces(includeArchived = false) {
  const pageSize = 100
  const first = await listWorkspaces({ page: 1, pageSize, includeArchived })
  if (first.total <= first.items.length) return first

  const items = [...first.items]
  for (let page = 2; items.length < first.total; page += 1) {
    const next = await listWorkspaces({ page, pageSize, includeArchived })
    if (!next.items.length) break
    items.push(...next.items)
  }
  return { ...first, items }
}

export function getWorkspace(workspaceId: string) {
  return api<Workspace>(`/workspaces/${workspaceId}`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function createWorkspace(
  tenantId: string,
  body: WorkspaceCreatePayload
) {
  return api<Workspace>(`/tenants/${tenantId}/workspaces`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateWorkspace(
  workspaceId: string,
  body: WorkspacePatchPayload
) {
  return api<Workspace>(`/workspaces/${workspaceId}`, {
    method: 'PATCH',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  })
}

export function listWorkspaceMembers(
  workspaceId: string,
  params: { page?: number; pageSize?: number } = {}
) {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 20),
  })
  return api<Page<WorkspaceMember>>(
    `/workspaces/${workspaceId}/members?${query}`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

export function putWorkspaceMember(
  workspaceId: string,
  userId: string,
  body: { workspace_role: WorkspaceRole }
) {
  return api<WorkspaceMembership>(
    `/workspaces/${workspaceId}/members/${userId}`,
    {
      method: 'PUT',
      headers: workspaceHeaders(workspaceId),
      body: JSON.stringify(body),
    }
  )
}

export function removeWorkspaceMember(workspaceId: string, userId: string) {
  return api<WorkspaceMembership>(
    `/workspaces/${workspaceId}/members/${userId}`,
    {
      method: 'DELETE',
      headers: workspaceHeaders(workspaceId),
    }
  )
}

export function transferWorkspaceOwnership(
  workspaceId: string,
  newOwnerUserId: string
) {
  return api<WorkspaceTransfer>(
    `/workspaces/${workspaceId}/transfer-ownership`,
    {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
      body: JSON.stringify({ new_owner_user_id: newOwnerUserId }),
    }
  )
}
