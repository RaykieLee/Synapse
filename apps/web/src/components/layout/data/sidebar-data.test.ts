import { describe, expect, it } from 'vitest'
import { ApiProblem } from '@/lib/api'
import {
  buildTenantNavigationGroup,
  buildWorkspaceNavigationGroup,
  isNavigationScopeRecoveryFailure,
  selectFreshAuthorizedNavigationCandidates,
  selectAuthorizedNavigationCandidates,
  selectPlatformNavigationGroup,
  type NavigationMenuResponse,
  type VerifiedNavigationScope,
} from './sidebar-data'

const scope: VerifiedNavigationScope = {
  verified: true,
  actorId: 'actor-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  membershipVersion: 7,
}

const menu: NavigationMenuResponse = {
  tenant_id: 'tenant-1',
  membership_version: 7,
  items: [
    {
      menu_id: 'menu-1',
      menu_name: 'Reports',
      path: '/reports',
      icon: 'FileText',
      is_frame: 1,
      children: [
        {
          menu_id: 'menu-2',
          menu_name: 'Daily',
          path: '/reports/daily',
          icon: null,
          is_frame: 1,
        },
      ],
    },
  ],
}

describe('authorized sidebar navigation model (simulated roles and API responses)', () => {
  it('shows platform links only for platform administrators', () => {
    expect(selectPlatformNavigationGroup(false)).toBeNull()
    expect(selectPlatformNavigationGroup(true)?.items.map((item) => item.url)).toEqual([
      '/tenants',
      '/users',
    ])
  })

  it('keeps tenant members separate from tenant administrators', () => {
    expect(buildTenantNavigationGroup('tenant-1', null)).toBeNull()
    expect(
      buildTenantNavigationGroup('tenant-1', 'member')?.items.map(
        (item) => item.url
      )
    ).toEqual(['/tenants/tenant-1'])
    expect(
      buildTenantNavigationGroup('tenant-1', 'admin')?.items.map(
        (item) => item.url
      )
    ).toContain('/tenants/tenant-1/roles')
  })

  it('keeps workspace members separate from workspace administrators', () => {
    const memberLinks = buildWorkspaceNavigationGroup(
      'workspace-1',
      'member'
    ).items.map((item) => item.url)
    const adminLinks = buildWorkspaceNavigationGroup(
      'workspace-1',
      'admin'
    ).items.map((item) => item.url)

    expect(memberLinks).toContain('/w/workspace-1/attachments')
    expect(memberLinks).toContain('/w/workspace-1/models')
    expect(memberLinks).not.toContain('/w/workspace-1/settings')
    expect(adminLinks).toContain('/w/workspace-1/settings')
  })

  it('returns dynamic candidates stamped with the verified actor and scope', () => {
    expect(selectAuthorizedNavigationCandidates(menu, scope)).toEqual([
      {
        id: 'menu-1',
        title: 'Reports',
        url: '/reports',
        external: false,
        icon: 'FileText',
        actorId: 'actor-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        membershipVersion: 7,
      },
      {
        id: 'menu-2',
        title: 'Reports / Daily',
        url: '/reports/daily',
        external: false,
        actorId: 'actor-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        membershipVersion: 7,
      },
    ])
  })

  it('rejects unverified or mismatched menu scope instead of returning links', () => {
    expect(selectAuthorizedNavigationCandidates(menu, null)).toBeNull()
    expect(
      selectAuthorizedNavigationCandidates(menu, {
        ...scope,
        verified: false,
      } as unknown as VerifiedNavigationScope)
    ).toBeNull()
    expect(
      selectAuthorizedNavigationCandidates(
        { ...menu, tenant_id: 'other-tenant' },
        scope
      )
    ).toBeNull()
    expect(
      selectAuthorizedNavigationCandidates(
        { ...menu, membership_version: 8 },
        scope
      )
    ).toBeNull()
  })

  it('distinguishes a confirmed empty menu from an invalid scope', () => {
    expect(
      selectAuthorizedNavigationCandidates({ ...menu, items: [] }, scope)
    ).toEqual([])
    expect(selectAuthorizedNavigationCandidates(menu, null)).toBeNull()
  })

  it('drops retained same-scope candidates after a failed refetch', () => {
    expect(
      selectFreshAuthorizedNavigationCandidates(menu, scope, false)
    ).toHaveLength(2)

    expect(
      selectFreshAuthorizedNavigationCandidates(menu, scope, true)
    ).toBeNull()
  })

  it('classifies revoked and mismatched navigation scope as recovery states', () => {
    expect(
      isNavigationScopeRecoveryFailure(new ApiProblem(403, 'FORBIDDEN'))
    ).toBe(true)
    expect(
      isNavigationScopeRecoveryFailure(new ApiProblem(400, 'CONTEXT_MISMATCH'))
    ).toBe(true)
    expect(
      isNavigationScopeRecoveryFailure(new ApiProblem(500, 'INTERNAL_ERROR'))
    ).toBe(false)
  })
})
