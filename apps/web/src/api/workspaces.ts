import { api } from '@/lib/api'
import type { components } from '@/api/generated/openapi'

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer'
export type WorkspaceStatus = 'active' | 'archived'

type WorkspaceResponse =
  components['schemas']['WorkspacePageResponse']['items'][number]

export type Workspace = Pick<
  WorkspaceResponse,
  'workspace_id' | 'tenant_id' | 'slug' | 'name' | 'icon'
> & {
  status: WorkspaceStatus
  settings?: WorkspaceResponse['settings']
  workspace_role: WorkspaceRole
  membership_version?: WorkspaceResponse['membership_version']
  created_by?: WorkspaceResponse['created_by']
  created_at?: WorkspaceResponse['created_at']
  updated_at?: WorkspaceResponse['updated_at']
}

export type WorkspacePage = Omit<
  components['schemas']['WorkspacePageResponse'],
  'items'
> & { items: Workspace[] }

type WorkspaceMemberResponse = components['schemas']['WorkspaceMemberResponse']

export type WorkspaceMember = Omit<
  WorkspaceMemberResponse,
  'workspace_role' | 'created_at' | 'updated_at'
> & {
  workspace_role: WorkspaceRole
  created_at?: WorkspaceMemberResponse['created_at']
  updated_at?: WorkspaceMemberResponse['updated_at']
}

export type WorkspaceMemberPage = Omit<
  components['schemas']['WorkspaceMemberPageResponse'],
  'items'
> & { items: WorkspaceMember[] }

export type Page<T> = {
  items: T[]
  total: number
  page: number
  page_size: number
}

export type WorkspaceCreatePayload = components['schemas']['WorkspaceCreate']

export type WorkspacePatchPayload = Omit<
  components['schemas']['WorkspacePatch'],
  'status'
> & { status?: WorkspaceStatus }

export type WorkspaceMembership = Omit<
  components['schemas']['WorkspaceMembershipResponse'],
  'workspace_role'
> & {
  workspace_role: WorkspaceRole
}

export type WorkspaceMemberRemoval =
  components['schemas']['WorkspaceMemberRemovalResponse']

export type WorkspaceTransfer = components['schemas']['WorkspaceTransferResponse']

export type WorkspaceMembershipPayload = Omit<
  components['schemas']['WorkspaceMemberPut'],
  'workspace_role'
> & { workspace_role: WorkspaceRole }

export type WorkspaceTransferPayload = components['schemas']['TransferOwnership']

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
  return api<WorkspacePage>(`/workspaces?${toWorkspaceQuery(params)}`)
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
  return api<WorkspaceMemberPage>(
    `/workspaces/${workspaceId}/members?${query}`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

export function putWorkspaceMember(
  workspaceId: string,
  userId: string,
  body: WorkspaceMembershipPayload
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
  return api<WorkspaceMemberRemoval>(
    `/workspaces/${workspaceId}/members/${userId}`,
    {
      method: 'DELETE',
      headers: workspaceHeaders(workspaceId),
    }
  )
}

export function transferWorkspaceOwnership(
  workspaceId: string,
  newOwnerUserId: WorkspaceTransferPayload['new_owner_user_id']
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
