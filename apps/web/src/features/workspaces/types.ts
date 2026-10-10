import type { WorkspaceRole, WorkspaceStatus } from '@/api/workspaces'

export type {
  Page,
  Workspace,
  WorkspaceRole,
  WorkspaceStatus,
} from '@/api/workspaces'

export type TenantSummary = {
  tenant_id: string
  name: string
  tenant_role: 'owner' | 'admin' | 'member' | null
}

export const roleLabel: Record<WorkspaceRole, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读成员',
}

export const statusLabel: Record<WorkspaceStatus, string> = {
  active: '正常',
  archived: '已归档',
}
