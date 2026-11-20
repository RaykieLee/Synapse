export type PermissionRoleContext = {
  platformRole?: string | null
  tenantRole?: string | null
  workspaceRole?: string | null
}

export type PermissionCapabilities = {
  platform: {
    managePlatformUsers: boolean
    viewTenantAdministration: boolean
    createTenants: boolean
    manageTenantLifecycle: boolean
    manageTenantSettings: boolean
  }
  tenant: {
    viewTenant: boolean
    viewTenantMembers: boolean
    manageTenantAdministration: boolean
    manageTenantMembers: boolean
    manageTenantRoles: boolean
    manageTenantSettings: boolean
    manageTenantInvitations: boolean
    inviteTenantAdmins: boolean
    createWorkspaces: boolean
  }
  workspace: {
    viewWorkspace: boolean
    readWorkspaceResources: boolean
    useWorkspaceResources: boolean
    manageWorkspaceMembers: boolean
    manageWorkspaceResources: boolean
    manageWorkspaceSettings: boolean
    transferWorkspaceOwnership: boolean
  }
}

const tenantRoles = ['owner', 'admin', 'member'] as const
const workspaceRoles = ['owner', 'admin', 'member', 'viewer'] as const

function hasRole<Role extends string>(
  role: string | null | undefined,
  knownRoles: readonly Role[]
): role is Role {
  return role != null && knownRoles.includes(role as Role)
}

export function getPermissionCapabilities({
  platformRole,
  tenantRole,
  workspaceRole,
}: PermissionRoleContext): PermissionCapabilities {
  const isPlatformAdmin = platformRole === 'platform_admin'
  const isTenantMember = hasRole(tenantRole, tenantRoles)
  const isTenantOwner = tenantRole === 'owner'
  const canManageTenant = isTenantOwner || tenantRole === 'admin'
  const isWorkspaceMember = hasRole(workspaceRole, workspaceRoles)
  const canManageWorkspace =
    workspaceRole === 'owner' || workspaceRole === 'admin'

  return {
    platform: {
      managePlatformUsers: isPlatformAdmin,
      viewTenantAdministration: isPlatformAdmin,
      createTenants: isPlatformAdmin,
      manageTenantLifecycle: isPlatformAdmin,
      manageTenantSettings: isPlatformAdmin,
    },
    tenant: {
      viewTenant: isTenantMember,
      viewTenantMembers: isTenantMember,
      manageTenantAdministration: canManageTenant,
      manageTenantMembers: canManageTenant,
      manageTenantRoles: canManageTenant,
      manageTenantSettings: canManageTenant,
      manageTenantInvitations: canManageTenant,
      inviteTenantAdmins: isTenantOwner,
      createWorkspaces: canManageTenant,
    },
    workspace: {
      viewWorkspace: isWorkspaceMember,
      readWorkspaceResources: isWorkspaceMember,
      useWorkspaceResources:
        workspaceRole === 'owner' ||
        workspaceRole === 'admin' ||
        workspaceRole === 'member',
      manageWorkspaceMembers: canManageWorkspace,
      manageWorkspaceResources: canManageWorkspace,
      manageWorkspaceSettings: canManageWorkspace,
      transferWorkspaceOwnership: workspaceRole === 'owner',
    },
  }
}
