import { queryKeys } from '@/lib/query-keys'
import type { Workspace } from './types'

export const WORKSPACE_QUERY_STALE_TIME = 10_000

export function workspaceDetailQueryKey(
  actorId: string,
  workspace: Pick<
    Workspace,
    'tenant_id' | 'workspace_id' | 'membership_version'
  >
) {
  return queryKeys.workspace.resource(
    queryKeys.workspaceScope(actorId, workspace),
    ['workspace-detail']
  )
}

export function unresolvedWorkspaceDetailQueryKey(
  actorId: string,
  workspaceId: string
) {
  return queryKeys.workspace.resource(
    { actorId, tenantId: 'unresolved', workspaceId, membershipVersion: 0 },
    ['workspace-detail']
  )
}
