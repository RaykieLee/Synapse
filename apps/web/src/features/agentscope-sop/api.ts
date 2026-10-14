import { api } from '@/lib/api'

const base = '/ai/sop'

// The shared api() helper adds Authorization; SOP also requires the verified
// workspace scope supplied by AgentScopeWorkspaceGateway.
const workspaceHeaders = (workspaceId: string) => ({
  'X-Workspace-ID': workspaceId,
})

export type JsonObject = Record<string, unknown>

function recordValue(value: unknown): JsonObject {
  return value && typeof value === 'object' ? (value as JsonObject) : {}
}

export type SopAgentRef = {
  agent_id: string
  session_key: string
}

export type AgentVerifier = {
  type: 'agent'
  agent: SopAgentRef
  criteria?: string
}

export type HumanVerifier = {
  type: 'human'
  question?: string
}

export type SopStep = {
  version?: 'v1'
  subject: string
  description: string
  executor: SopAgentRef
  verifier?: AgentVerifier | HumanVerifier | null
  max_attempts?: number
  [key: string]: unknown
}

export type SopData = {
  name: string
  description?: string
  steps: SopStep[]
  workspace_grain?: 'run' | 'per_session_key'
  session_settings?: Record<string, JsonObject>
  [key: string]: unknown
}

export type SopRecord = {
  id: string
  user_id: string
  data: SopData
  created_at?: string
  updated_at?: string
}

export type SopSchemaResponse = {
  schema: JsonObject
}

export type SopListResponse = {
  sops: SopRecord[]
  total: number
}

export type SopRunStep = {
  phase?: string
  given?: unknown[]
  submission?: unknown[] | null
  verifications?: Array<{
    passed: boolean
    message?: string
    verifier?: string
    created_at?: string
  }>
  [key: string]: unknown
}

export type SopRun = {
  id: string
  user_id: string
  sop_id: string
  definition: SopData
  sessions?: Record<string, string>
  state?: {
    id?: string
    phase?: string
    inputs?: unknown[]
    steps?: SopRunStep[]
    created_at?: string
  }
  created_at?: string
  updated_at?: string
}

export type SopRunListResponse = {
  runs: SopRun[]
  total: number
}

export type SopAgentOption = {
  id: string
  name: string
}

export type SopCredentialOption = {
  id: string
  name: string
  type: string
}

export function getSopSchema(workspaceId: string) {
  return api<SopSchemaResponse>(`${base}/schema`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function listSops(workspaceId: string) {
  return api<SopListResponse>(`${base}/`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function getSop(workspaceId: string, sopId: string) {
  return api<SopRecord>(`${base}/${encodeURIComponent(sopId)}`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function createSop(workspaceId: string, data: unknown) {
  return api<{ sop_id: string }>(`${base}/`, {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({ data }),
  })
}

export function updateSop(
  workspaceId: string,
  sopId: string,
  data: unknown
) {
  return api<SopRecord>(`${base}/${encodeURIComponent(sopId)}`, {
    method: 'PATCH',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({ data }),
  })
}

export function deleteSop(workspaceId: string, sopId: string) {
  return api<void>(`${base}/${encodeURIComponent(sopId)}`, {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceId),
  })
}

export function listSopRuns(
  workspaceId: string,
  params: { sopId?: string; phase?: string } = {}
) {
  const search = new URLSearchParams()
  if (params.sopId) search.set('sop_id', params.sopId)
  if (params.phase) search.set('phase', params.phase)
  const query = search.size ? `?${search}` : ''
  return api<SopRunListResponse>(`${base}/runs${query}`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function getSopRun(workspaceId: string, runId: string) {
  return api<SopRun>(`${base}/runs/${encodeURIComponent(runId)}`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function deleteSopRun(workspaceId: string, runId: string) {
  return api<void>(`${base}/runs/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceId),
  })
}

export function startSopRun(
  workspaceId: string,
  sopId: string,
  inputs: unknown[]
) {
  return api<SopRun>(`${base}/${encodeURIComponent(sopId)}/runs`, {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({ inputs }),
  })
}

export function submitSopVerdict(
  workspaceId: string,
  runId: string,
  body: { step_index: number; passed: boolean; message?: string }
) {
  return api<SopRun>(`${base}/runs/${encodeURIComponent(runId)}/verdict`, {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  })
}

export async function listSopEditorAgents(workspaceId: string) {
  const response = await api<{ agents?: Array<JsonObject> }>(`/ai/agent/`, {
    headers: workspaceHeaders(workspaceId),
  })
  return (response.agents ?? []).flatMap((item): SopAgentOption[] => {
    if (typeof item.id !== 'string') return []
    const data = recordValue(item.data)
    const name =
      data && typeof data === 'object' && typeof data.name === 'string'
        ? data.name
        : typeof item.name === 'string'
          ? item.name
          : item.id
    return [{ id: item.id, name }]
  })
}

export async function listSopEditorCredentials(workspaceId: string) {
  const response = await api<{
    credentials?: Array<JsonObject>
  }>(`/ai/credential/`, {
    headers: workspaceHeaders(workspaceId),
  })
  return (response.credentials ?? []).flatMap((item): SopCredentialOption[] => {
    if (typeof item.id !== 'string') return []
    const data = recordValue(item.data)
    const name =
      data && typeof data === 'object' && typeof data.name === 'string'
        ? data.name
        : item.id
    const type =
      data && typeof data === 'object' && typeof data.type === 'string'
        ? data.type
        : ''
    return [{ id: item.id, name, type }]
  })
}
