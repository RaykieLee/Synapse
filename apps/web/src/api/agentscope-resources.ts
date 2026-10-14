import { api } from '@/lib/api'

const base = '/ai'
const workspaceHeaders = (workspaceId: string) => ({
  'X-Workspace-ID': workspaceId,
})

export type KnowledgeBaseView = {
  id: string
  name: string
  description: string
  credential_name?: string | null
  editable: boolean
  document_count?: number
  chunk_count?: number
  [key: string]: unknown
}

export type KnowledgeDocumentView = {
  id: string
  filename: string
  size: number
  content_type?: string | null
  status: 'pending' | 'parsing' | 'chunking' | 'indexing' | 'ready' | 'error' | string
  error?: string | null
  chunk_count: number
  created_at: string
  updated_at: string
}

export type KnowledgeBaseListResponse = {
  knowledge_bases: KnowledgeBaseView[]
  total: number
  page: number
  page_size: number
}

export type KnowledgeDocumentListResponse = {
  documents: KnowledgeDocumentView[]
  total: number
  page: number
  page_size: number
}

export type KnowledgeCreatePayload = {
  name: string
  description: string
  embedding_model_config: Record<string, unknown>
  chunker_config?: Record<string, unknown> | null
}

export type KnowledgeUpdatePayload = {
  name?: string
  description?: string
}

export type EmbeddingModelsResponse = {
  providers: Array<{
    credential: Record<string, unknown>
    models: Array<Record<string, unknown>>
  }>
  policy: Record<string, unknown>
}

export type ChunkersResponse = {
  chunkers: Array<{
    type: string
    parameter_schema: Record<string, unknown>
  }>
}

export function listKnowledgeBases(
  workspaceId: string,
  params: { page?: number; pageSize?: number; name?: string } = {}
) {
  const search = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 30),
    orderby: 'update_time',
    desc: 'true',
  })
  if (params.name?.trim()) search.set('name', params.name.trim())
  return api<KnowledgeBaseListResponse>(`${base}/knowledge_bases/?${search}`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function listKnowledgeEmbeddingModels(workspaceId: string) {
  return api<EmbeddingModelsResponse>(`${base}/knowledge_bases/embedding_models`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function listKnowledgeChunkers(workspaceId: string) {
  return api<ChunkersResponse>(`${base}/knowledge_bases/chunkers`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function createKnowledgeBase(
  workspaceId: string,
  body: KnowledgeCreatePayload
) {
  return api<{ knowledge_base_id: string }>(`${base}/knowledge_bases/`, {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  })
}

export function updateKnowledgeBase(
  workspaceId: string,
  id: string,
  body: KnowledgeUpdatePayload
) {
  return api<KnowledgeBaseView>(`${base}/knowledge_bases/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  })
}

export function deleteKnowledgeBase(workspaceId: string, id: string) {
  return api<void>(`${base}/knowledge_bases/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceId),
  })
}

export function listKnowledgeDocuments(
  workspaceId: string,
  knowledgeBaseId: string,
  params: { page?: number; pageSize?: number; keywords?: string; status?: string } = {}
) {
  const search = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 30),
    orderby: 'update_time',
    desc: 'true',
  })
  if (params.keywords?.trim()) search.set('keywords', params.keywords.trim())
  if (params.status) search.set('status', params.status)
  return api<KnowledgeDocumentListResponse>(
    `${base}/knowledge_bases/${encodeURIComponent(knowledgeBaseId)}/documents?${search}`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

export function uploadKnowledgeDocument(
  workspaceId: string,
  knowledgeBaseId: string,
  file: File
) {
  const body = new FormData()
  body.set('file', file)
  if (file.type) body.set('content_type', file.type)
  return api<{ document_id: string; filename: string; status: string }>(
    `${base}/knowledge_bases/${encodeURIComponent(knowledgeBaseId)}/documents`,
    {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
      body,
    }
  )
}

export function deleteKnowledgeDocument(
  workspaceId: string,
  knowledgeBaseId: string,
  documentId: string
) {
  return api<void>(
    `${base}/knowledge_bases/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}`,
    { method: 'DELETE', headers: workspaceHeaders(workspaceId) }
  )
}

export type ResourceHub = {
  hub_id: string
  display_name: string
  description: string
  icon_url?: string | null
}

export type McpView = {
  id: string
  name: string
  is_stateful: boolean
  enabled: boolean
  display_name?: string | null
  description: string
  tags: string[]
  author?: string | null
  url?: string | null
  hub_id?: string | null
  card_id?: string | null
  version?: string | null
}

export type SkillView = {
  id: string
  name: string
  enabled: boolean
  display_name?: string | null
  description: string
  tags: string[]
  author?: string | null
  url?: string | null
  hub_id?: string | null
  card_id?: string | null
  version?: string | null
}

export type McpCard = {
  id: string
  name: string
  display_name?: string | null
  description: string
  tags: string[]
  author?: string | null
  version?: string | null
  url?: string | null
  inputs_schema: Record<string, unknown>
  [key: string]: unknown
}

export type SkillCard = {
  id: string
  name: string
  display_name?: string | null
  description: string
  tags: string[]
  author?: string | null
  version?: string | null
  url?: string | null
  markdown?: string | null
  [key: string]: unknown
}

export type HubPage<T> = {
  cards: T[]
  next_cursor?: string | null
}

export function listMcps(workspaceId: string) {
  return api<McpView[]>(`${base}/mcp`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function updateMcp(
  workspaceId: string,
  id: string,
  body: { name?: string; enabled?: boolean; values?: Record<string, unknown> }
) {
  return api<McpView>(`${base}/mcp/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  })
}

export function deleteMcp(workspaceId: string, id: string) {
  return api<void>(`${base}/mcp/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceId),
  })
}

export function listMcpHubs(workspaceId: string) {
  return api<ResourceHub[]>(`${base}/hub/mcp`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function listMcpCards(
  workspaceId: string,
  hubId: string,
  params: { q?: string; cursor?: string }
) {
  const search = new URLSearchParams({ limit: '30' })
  if (params.q?.trim()) search.set('q', params.q.trim())
  if (params.cursor) search.set('cursor', params.cursor)
  return api<HubPage<McpCard>>(
    `${base}/hub/mcp/${encodeURIComponent(hubId)}/cards?${search}`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

export function getMcpCard(workspaceId: string, hubId: string, cardId: string) {
  return api<McpCard>(
    `${base}/hub/mcp/${encodeURIComponent(hubId)}/cards/${encodeURIComponent(cardId)}`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

export function installMcp(
  workspaceId: string,
  hubId: string,
  cardId: string,
  body: { name?: string; values: Record<string, unknown> }
) {
  return api<McpView>(
    `${base}/hub/mcp/${encodeURIComponent(hubId)}/cards/${encodeURIComponent(cardId)}/install`,
    {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
      body: JSON.stringify(body),
    }
  )
}

export function listSkills(workspaceId: string) {
  return api<SkillView[]>(`${base}/skill`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function getSkill(workspaceId: string, id: string) {
  return api<SkillView & { markdown?: string }>(
    `${base}/skill/${encodeURIComponent(id)}`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

export function deleteSkill(workspaceId: string, id: string) {
  return api<void>(`${base}/skill/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceId),
  })
}

export function listSkillHubs(workspaceId: string) {
  return api<ResourceHub[]>(`${base}/hub/skill`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function listSkillCards(
  workspaceId: string,
  hubId: string,
  params: { q?: string; cursor?: string }
) {
  const search = new URLSearchParams({ limit: '30' })
  if (params.q?.trim()) search.set('q', params.q.trim())
  if (params.cursor) search.set('cursor', params.cursor)
  return api<HubPage<SkillCard>>(
    `${base}/hub/skill/${encodeURIComponent(hubId)}/cards?${search}`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

export function getSkillCard(workspaceId: string, hubId: string, cardId: string) {
  return api<SkillCard>(
    `${base}/hub/skill/${encodeURIComponent(hubId)}/cards/${encodeURIComponent(cardId)}`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

export function installSkill(
  workspaceId: string,
  hubId: string,
  cardId: string,
  name?: string
) {
  const search = name ? `?name=${encodeURIComponent(name)}` : ''
  return api<SkillView>(
    `${base}/hub/skill/${encodeURIComponent(hubId)}/cards/${encodeURIComponent(cardId)}/install${search}`,
    {
      method: 'POST',
      headers: workspaceHeaders(workspaceId),
    }
  )
}
