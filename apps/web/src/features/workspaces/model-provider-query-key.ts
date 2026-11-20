import { queryKeys } from '@/lib/query-keys'

export function modelProviderQueryKey(
  actorId: string,
  tenantId: string,
  workspaceId: string,
  membershipVersion: number
) {
  return queryKeys.workspace.resource(
    { actorId, tenantId, workspaceId, membershipVersion },
    'model-providers'
  )
}
