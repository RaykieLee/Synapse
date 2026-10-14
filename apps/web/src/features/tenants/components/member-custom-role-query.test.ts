import { describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { memberCustomRoleQueryOptions } from './member-custom-role-query'

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}))

describe('memberCustomRoleQueryOptions', () => {
  it('scopes the assignment query by actor, tenant, membership version, and user', () => {
    const options = memberCustomRoleQueryOptions({
      actorId: 'actor-1',
      tenantId: 'tenant-1',
      membershipVersion: 7,
      userId: 'user-1',
      enabled: true,
    })

    expect(options.queryKey).toEqual([
      'synapse',
      'actor-1',
      'tenant-1',
      'personal',
      'member-custom-role',
      7,
      'user-1',
    ])
    expect(options.enabled).toBe(true)
  })

  it('uses the tenant member custom-role endpoint', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      user_id: 'user-1',
      role: null,
    })
    const options = memberCustomRoleQueryOptions({
      actorId: 'actor-1',
      tenantId: 'tenant-1',
      membershipVersion: 7,
      userId: 'user-1',
      enabled: false,
    })

    await options.queryFn?.({
      queryKey: options.queryKey,
      client: {} as never,
      signal: new AbortController().signal,
      meta: undefined,
    })

    expect(api).toHaveBeenCalledWith(
      '/tenants/tenant-1/members/user-1/custom-role'
    )
  })
})
