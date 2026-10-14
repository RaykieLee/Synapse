import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { MemberCustomRoleResponse } from '../types'

export function memberCustomRoleQueryOptions({
  actorId,
  tenantId,
  membershipVersion,
  userId,
  enabled,
}: {
  actorId: string
  tenantId: string
  membershipVersion: number
  userId: string
  enabled: boolean
}) {
  return queryOptions({
    queryKey: [
      'synapse',
      actorId,
      tenantId,
      'personal',
      'member-custom-role',
      membershipVersion,
      userId,
    ],
    enabled,
    queryFn: () =>
      api<MemberCustomRoleResponse>(
        `/tenants/${tenantId}/members/${userId}/custom-role`
      ),
  })
}
