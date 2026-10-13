export function modelProviderQueryKey(
  actorId: string,
  tenantId: string,
  workspaceId: string,
  membershipVersion: number
) {
  return [
    'synapse',
    actorId,
    tenantId,
    workspaceId,
    'model-provider',
    membershipVersion,
  ] as const
}
