import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
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
  const tenantScope = { actorId, tenantId, membershipVersion }
  return queryOptions({
    queryKey: queryKeys.tenant.query(
      tenantScope,
      ['members', 'custom-role'],
      { userId }
    ),
    enabled,
    queryFn: () =>
      api<MemberCustomRoleResponse>(
        `/tenants/${tenantId}/members/${userId}/custom-role`
      ),
  })
}
