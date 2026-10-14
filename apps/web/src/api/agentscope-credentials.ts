import { api } from '@/lib/api'

const base = '/ai'

const workspaceHeaders = (workspaceId: string) => ({
  'X-Workspace-ID': workspaceId,
})

export type CredentialSchemaProperty = {
  type?: string
  anyOf?: Array<{ type?: string; enum?: unknown[] }>
  enum?: unknown[]
  const?: unknown
  default?: unknown
  description?: string
  format?: string
  title?: string
  writeOnly?: boolean
}

export type CredentialSchema = {
  title: string
  description?: string
  properties: Record<string, CredentialSchemaProperty>
  required?: string[]
}

export type CredentialView = {
  id: string
  user_id: string
  data: Record<string, unknown>
  editable: boolean
  created_at?: string
  updated_at?: string
}

export type CredentialSchemasResponse = {
  schemas: CredentialSchema[]
}

export type CredentialListResponse = {
  credentials: CredentialView[]
  total: number
}

export type ModelCard = {
  name: string
  label?: string
  description?: string
  input_types?: string[]
  output_types?: string[]
  context_size?: number
  output_size?: number
  status?: string
  [key: string]: unknown
}

export type ModelListResponse = {
  models: ModelCard[]
  total: number
}

export function listCredentialSchemas(workspaceId: string) {
  return api<CredentialSchemasResponse>(`${base}/credential/schemas`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function listCredentials(workspaceId: string) {
  return api<CredentialListResponse>(`${base}/credential/`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function createCredential(
  workspaceId: string,
  data: Record<string, unknown>
) {
  return api<{ credential_id: string }>(`${base}/credential/`, {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({ data }),
  })
}

export function updateCredential(
  workspaceId: string,
  credentialId: string,
  data: Record<string, unknown>
) {
  return api<CredentialView>(
    `${base}/credential/${encodeURIComponent(credentialId)}`,
    {
      method: 'PATCH',
      headers: workspaceHeaders(workspaceId),
      body: JSON.stringify({ data }),
    }
  )
}

export function deleteCredential(workspaceId: string, credentialId: string) {
  return api<void>(
    `${base}/credential/${encodeURIComponent(credentialId)}`,
    {
      method: 'DELETE',
      headers: workspaceHeaders(workspaceId),
    }
  )
}

export function listAgentScopeModels(workspaceId: string, provider: string) {
  const query = new URLSearchParams({ provider })
  return api<ModelListResponse>(`${base}/model/?${query}`, {
    headers: workspaceHeaders(workspaceId),
  })
}
