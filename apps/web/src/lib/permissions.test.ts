import { describe, expect, it } from 'vitest'
import { getPermissionCapabilities } from './permissions'

describe('getPermissionCapabilities', () => {
  it('grants platform capabilities only for platform_admin', () => {
    const permissions = getPermissionCapabilities({
      platformRole: 'platform_admin',
    })

    expect(permissions.platform).toEqual({
      managePlatformUsers: true,
      viewTenantAdministration: true,
      createTenants: true,
      manageTenantLifecycle: true,
      manageTenantSettings: true,
    })
    expect(permissions.tenant.manageTenantMembers).toBe(false)
    expect(permissions.workspace.manageWorkspaceMembers).toBe(false)
  })

  it('denies platform capabilities to regular and unknown platform roles', () => {
    for (const platformRole of ['user', 'unknown']) {
      const permissions = getPermissionCapabilities({ platformRole })

      expect(permissions.platform.managePlatformUsers).toBe(false)
      expect(permissions.platform.viewTenantAdministration).toBe(false)
    }
  })

  it.each([
    { role: 'owner', canManage: true, canInviteAdmins: true },
    { role: 'admin', canManage: true, canInviteAdmins: false },
    { role: 'member', canManage: false, canInviteAdmins: false },
  ])(
    'maps tenant $role permissions within the tenant scope',
    ({ role, canManage, canInviteAdmins }) => {
      const permissions = getPermissionCapabilities({ tenantRole: role })

      expect(permissions.tenant.viewTenant).toBe(true)
      expect(permissions.tenant.viewTenantMembers).toBe(true)
      expect(permissions.tenant.manageTenantAdministration).toBe(canManage)
      expect(permissions.tenant.manageTenantMembers).toBe(canManage)
      expect(permissions.tenant.manageTenantRoles).toBe(canManage)
      expect(permissions.tenant.manageTenantSettings).toBe(canManage)
      expect(permissions.tenant.manageTenantInvitations).toBe(canManage)
      expect(permissions.tenant.inviteTenantAdmins).toBe(canInviteAdmins)
      expect(permissions.tenant.createWorkspaces).toBe(canManage)
      expect(permissions.platform.managePlatformUsers).toBe(false)
      expect(permissions.workspace.manageWorkspaceMembers).toBe(false)
    }
  )

  it('denies tenant capabilities for an unknown tenant role', () => {
    const permissions = getPermissionCapabilities({ tenantRole: 'unknown' })

    expect(permissions.tenant.viewTenant).toBe(false)
    expect(permissions.tenant.manageTenantMembers).toBe(false)
    expect(permissions.tenant.manageTenantSettings).toBe(false)
  })

  it.each([
    {
      role: 'owner',
      canManage: true,
      canUseResources: true,
      canTransferOwnership: true,
    },
    {
      role: 'admin',
      canManage: true,
      canUseResources: true,
      canTransferOwnership: false,
    },
    {
      role: 'member',
      canManage: false,
      canUseResources: true,
      canTransferOwnership: false,
    },
    {
      role: 'viewer',
      canManage: false,
      canUseResources: false,
      canTransferOwnership: false,
    },
  ])(
    'maps Workspace $role permissions within the Workspace scope',
    ({ role, canManage, canUseResources, canTransferOwnership }) => {
      const permissions = getPermissionCapabilities({ workspaceRole: role })

      expect(permissions.workspace.viewWorkspace).toBe(true)
      expect(permissions.workspace.readWorkspaceResources).toBe(true)
      expect(permissions.workspace.useWorkspaceResources).toBe(canUseResources)
      expect(permissions.workspace.manageWorkspaceMembers).toBe(canManage)
      expect(permissions.workspace.manageWorkspaceResources).toBe(canManage)
      expect(permissions.workspace.manageWorkspaceSettings).toBe(canManage)
      expect(permissions.workspace.transferWorkspaceOwnership).toBe(
        canTransferOwnership
      )
      expect(permissions.platform.managePlatformUsers).toBe(false)
      expect(permissions.tenant.manageTenantMembers).toBe(false)
    }
  )

  it('denies Workspace capabilities for an unknown Workspace role', () => {
    const permissions = getPermissionCapabilities({
      workspaceRole: 'unknown',
    })

    expect(permissions.workspace.viewWorkspace).toBe(false)
    expect(permissions.workspace.readWorkspaceResources).toBe(false)
    expect(permissions.workspace.useWorkspaceResources).toBe(false)
    expect(permissions.workspace.manageWorkspaceMembers).toBe(false)
    expect(permissions.workspace.manageWorkspaceSettings).toBe(false)
  })

  it('does not infer tenant or Workspace access from platform administration', () => {
    const permissions = getPermissionCapabilities({
      platformRole: 'platform_admin',
    })

    expect(permissions.platform.managePlatformUsers).toBe(true)
    expect(permissions.tenant.viewTenant).toBe(false)
    expect(permissions.tenant.manageTenantMembers).toBe(false)
    expect(permissions.workspace.viewWorkspace).toBe(false)
    expect(permissions.workspace.manageWorkspaceMembers).toBe(false)
  })

  it('does not infer Workspace access from tenant membership or roles', () => {
    const permissions = getPermissionCapabilities({ tenantRole: 'owner' })

    expect(permissions.tenant.manageTenantMembers).toBe(true)
    expect(permissions.workspace.viewWorkspace).toBe(false)
    expect(permissions.workspace.manageWorkspaceMembers).toBe(false)
    expect(permissions.workspace.manageWorkspaceResources).toBe(false)
  })

  it('does not infer platform or tenant access from a Workspace role', () => {
    const permissions = getPermissionCapabilities({ workspaceRole: 'owner' })

    expect(permissions.workspace.manageWorkspaceMembers).toBe(true)
    expect(permissions.platform.managePlatformUsers).toBe(false)
    expect(permissions.platform.viewTenantAdministration).toBe(false)
    expect(permissions.tenant.viewTenant).toBe(false)
    expect(permissions.tenant.manageTenantMembers).toBe(false)
  })
})
