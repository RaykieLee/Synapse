import { describe, expect, it } from 'vitest'
import {
  normalizeQueryKeyParams,
  queryKeys,
  workspaceQueryScope,
} from './query-keys'

const workspace = {
  tenant_id: 'tenant-7',
  workspace_id: 'workspace-11',
  membership_version: 3,
}

describe('query key factory', () => {
  it('includes actor, tenant, workspace, membership version, domain, resource, and params', () => {
    expect(
      queryKeys.workspace.query(
        workspaceQueryScope('actor-1', workspace),
        'members',
        { page: 2, pageSize: 20 }
      )
    ).toEqual([
      'synapse',
      'actor-1',
      'tenant-7',
      'workspace-11',
      'membership',
      3,
      'workspace',
      'members',
      { page: 2, pageSize: 20 },
    ])
  })

  it('keeps actor, tenant, workspace, and membership caches separate', () => {
    const base = workspaceQueryScope('actor-1', workspace)
    const key = queryKeys.agentscope.query(base, ['chat', 'messages'])
    const otherActor = queryKeys.agentscope.query(
      workspaceQueryScope('actor-2', workspace),
      ['chat', 'messages']
    )
    const otherTenant = queryKeys.agentscope.query(
      workspaceQueryScope('actor-1', {
        ...workspace,
        tenant_id: 'tenant-8',
      }),
      ['chat', 'messages']
    )
    const otherWorkspace = queryKeys.agentscope.query(
      workspaceQueryScope('actor-1', {
        ...workspace,
        workspace_id: 'workspace-12',
      }),
      ['chat', 'messages']
    )
    const otherMembership = queryKeys.agentscope.query(
      workspaceQueryScope('actor-1', {
        ...workspace,
        membership_version: 4,
      }),
      ['chat', 'messages']
    )

    expect(otherActor).not.toEqual(key)
    expect(otherTenant).not.toEqual(key)
    expect(otherWorkspace).not.toEqual(key)
    expect(otherMembership).not.toEqual(key)
  })

  it('uses one AgentScope domain and allows module-level invalidation prefixes', () => {
    const scope = workspaceQueryScope('actor-1', workspace)
    const opsKey = queryKeys.agentscope.query(scope, ['ops', 'schedules'])
    const chatKey = queryKeys.agentscope.query(scope, ['chat', 'sessions'])
    const opsPrefix = queryKeys.agentscope.resource(scope, 'ops')

    expect(opsKey.slice(0, opsPrefix.length)).toEqual(opsPrefix)
    expect(chatKey.slice(0, opsPrefix.length)).not.toEqual(opsPrefix)
    expect(opsKey[6]).toBe('agentscope')
    expect(chatKey[6]).toBe('agentscope')
  })

  it('normalizes nested params and drops undefined values', () => {
    expect(
      normalizeQueryKeyParams({
        z: undefined,
        filters: {
          status: 'active',
          createdAfter: new Date('2026-01-01T00:00:00Z'),
        },
        page: 1,
      })
    ).toEqual({
      filters: {
        createdAfter: '2026-01-01T00:00:00.000Z',
        status: 'active',
      },
      page: 1,
    })
  })

  it('rejects workspace keys without their tenant scope', () => {
    expect(() =>
      queryKeys.workspace.query(
        { actorId: 'actor-1', workspaceId: 'workspace-11' },
        'detail'
      )
    ).toThrow('Workspace query keys require a tenant ID.')
  })

  it('supports actor-scoped global query prefixes', () => {
    const scope = queryKeys.actorScope('actor-1')
    const listKey = queryKeys.global.query(scope, ['users', 'list'], {
      page: 2,
    })
    const prefix = queryKeys.global.resource(scope, ['users', 'list'])

    expect(listKey).toEqual([
      'synapse',
      'actor-1',
      'global',
      'personal',
      'membership',
      'unversioned',
      'global',
      'users',
      'list',
      { page: 2 },
    ])
    expect(listKey.slice(0, prefix.length)).toEqual(prefix)
  })

  it('scopes tenant details and member lists by actor, tenant, and membership version', () => {
    const baseScope = { actorId: 'actor-1', tenantId: 'tenant-7' }
    const detailKey = queryKeys.tenant.query(baseScope, 'detail')
    const memberScope = { ...baseScope, membershipVersion: 8 }
    const membersKey = queryKeys.tenant.query(
      memberScope,
      ['members', 'list'],
      { page: 2, pageSize: 20 }
    )
    const membersPrefix = queryKeys.tenant.resource(
      memberScope,
      ['members', 'list']
    )
    const nextMembershipKey = queryKeys.tenant.query(
      { ...memberScope, membershipVersion: 9 },
      ['members', 'list'],
      { page: 2, pageSize: 20 }
    )

    expect(detailKey).toEqual([
      'synapse',
      'actor-1',
      'tenant-7',
      'personal',
      'membership',
      'unversioned',
      'tenant',
      'detail',
      {},
    ])
    expect(membersKey.slice(0, membersPrefix.length)).toEqual(membersPrefix)
    expect(nextMembershipKey).not.toEqual(membersKey)
  })
})
