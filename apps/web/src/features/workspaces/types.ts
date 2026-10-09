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

export type TenantSummary = {
  tenant_id: string
  name: string
  tenant_role: 'owner' | 'admin' | 'member' | null
}

export type Page<T> = { items: T[]; total: number; page: number; page_size: number }

export const roleLabel: Record<WorkspaceRole, string> = {
  owner: '所有者', admin: '管理员', member: '成员', viewer: '只读成员',
}

export const statusLabel: Record<WorkspaceStatus, string> = {
  active: '正常', archived: '已归档',
}
