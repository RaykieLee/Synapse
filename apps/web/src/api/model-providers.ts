import { api } from '@/lib/api'

export type Provider = {
  provider_type: string
  credential_type: string
  label: string
  capabilities: string[]
  credential_schema_version: number
  supports_custom_model_id: boolean
  supports_base_url: boolean
}

export type Credential = {
  credential_id: string
  workspace_id: string
  provider_type: string
  name: string
  endpoint_host: string
  has_secret: boolean
  owner: boolean
  created_at: string
  updated_at: string
}

export type ModelBinding = {
  model_binding_id: string
  workspace_id: string
  display_name: string
  kind: string
  provider_type: string
  credential_status: 'available' | 'owner_only' | 'unavailable'
  credential_provider: string
  model: string
  status: 'active' | 'disabled'
  capabilities: Record<string, unknown>
  default_parameters: Record<string, unknown>
  created_by: string
  created_at: string
  updated_at: string
}

export type CredentialCreatePayload = {
  provider_type: string
  name: string
  api_key: string
  base_url: string
  organization?: string | null
}

export type CredentialPatchPayload = {
  name?: string
  api_key?: string
  base_url?: string
  organization?: string | null
}

export type ModelBindingCreatePayload = {
  credential_id: string
  display_name: string
  kind: 'chat'
  provider_type: string
  model: string
  capabilities?: Record<string, unknown>
  default_parameters?: Record<string, unknown>
}

const headers = (workspaceId: string) => ({ 'X-Workspace-ID': workspaceId })
const path = (workspaceId: string, resource: string) =>
  `/workspaces/${workspaceId}/ai/${resource}`

export function listProviders(workspaceId: string) {
  return api<Provider[]>(path(workspaceId, 'providers'), {
    headers: headers(workspaceId),
  })
}

export function listCredentials(workspaceId: string) {
  return api<Credential[]>(path(workspaceId, 'credentials'), {
    headers: headers(workspaceId),
  })
}

export function createCredential(
  workspaceId: string,
  body: CredentialCreatePayload
) {
  return api<Credential>(path(workspaceId, 'credentials'), {
    method: 'POST',
    headers: headers(workspaceId),
    body: JSON.stringify(body),
  })
}

export function updateCredential(
  workspaceId: string,
  credentialId: string,
  body: CredentialPatchPayload
) {
  return api<Credential>(path(workspaceId, `credentials/${credentialId}`), {
    method: 'PATCH',
    headers: headers(workspaceId),
    body: JSON.stringify(body),
  })
}

export function deleteCredential(workspaceId: string, credentialId: string) {
  return api<void>(path(workspaceId, `credentials/${credentialId}`), {
    method: 'DELETE',
    headers: headers(workspaceId),
  })
}

export function listModelBindings(workspaceId: string) {
  return api<ModelBinding[]>(path(workspaceId, 'models'), {
    headers: headers(workspaceId),
  })
}

export function createModelBinding(
  workspaceId: string,
  body: ModelBindingCreatePayload
) {
  return api<ModelBinding>(path(workspaceId, 'models'), {
    method: 'POST',
    headers: headers(workspaceId),
    body: JSON.stringify(body),
  })
}

export function updateModelBinding(
  workspaceId: string,
  modelBindingId: string,
  body: {
    display_name?: string
    model?: string
    status?: 'active' | 'disabled'
  }
) {
  return api<ModelBinding>(path(workspaceId, `models/${modelBindingId}`), {
    method: 'PATCH',
    headers: headers(workspaceId),
    body: JSON.stringify(body),
  })
}

export function deleteModelBinding(
  workspaceId: string,
  modelBindingId: string
) {
  return api<void>(path(workspaceId, `models/${modelBindingId}`), {
    method: 'DELETE',
    headers: headers(workspaceId),
  })
}
