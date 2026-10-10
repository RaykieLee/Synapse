import { api, type AuthUser } from '@/lib/api'

export type TenantInvitationRole = 'admin' | 'member'

export type TenantInvitation = {
  invitation_id: string
  tenant_id: string
  email: string | null
  target_user_id: string | null
  tenant_role: TenantInvitationRole
  status: string
  expired: boolean
  expires_at: string
  invited_by: string
  created_at: string
}

export type CreatedTenantInvitation = TenantInvitation & {
  token: string
  invite_link: string
}

export type TenantInvitationPage = {
  items: TenantInvitation[]
}

export type TenantInvitationCreatePayload = {
  email?: string
  user_id?: string
  tenant_role?: TenantInvitationRole
  expires_in_hours?: number
}

export type TenantInvitationAcceptPayload = {
  token: string
}

export type TenantInvitationRegisterPayload = {
  token: string
  user_name: string
  password: string
  nick_name?: string
}

export type TenantInvitationMembership = {
  tenant_id: string
  user_id: string
  status: string
  tenant_role: TenantInvitationRole
  joined_at: string
  workspace_memberships_created: number
}

export type TenantInvitationRegisterResult = {
  access_token: string
  token_type: 'bearer'
  user: AuthUser
  tenant: TenantInvitationMembership
}

export function listTenantInvitations(tenantId: string) {
  return api<TenantInvitationPage>(`/tenants/${tenantId}/invitations`)
}

export function createTenantInvitation(
  tenantId: string,
  payload: TenantInvitationCreatePayload
) {
  return api<CreatedTenantInvitation>(`/tenants/${tenantId}/invitations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function revokeTenantInvitation(
  tenantId: string,
  invitationId: string
) {
  return api<void>(`/tenants/${tenantId}/invitations/${invitationId}`, {
    method: 'DELETE',
  })
}

export function acceptTenantInvitation(payload: TenantInvitationAcceptPayload) {
  return api<TenantInvitationMembership>('/tenant-invitations/accept', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function registerAndAcceptTenantInvitation(
  payload: TenantInvitationRegisterPayload
) {
  return api<TenantInvitationRegisterResult>(
    '/tenant-invitations/register-and-accept',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  )
}
