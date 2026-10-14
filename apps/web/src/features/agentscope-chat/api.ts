import { ApiProblem, api, type ApiRequestInit } from '@/lib/api'
import type { Workspace } from '@/features/workspaces/types'
import type {
  AgentScopeCredential,
  CredentialWithModels,
  CredentialWithRealtimeModels,
  JSONSchema,
  ModelCard,
  RealtimeModelCard,
  SessionMcp,
  SessionSkill,
} from './types'

export { ApiProblem }

export const agentScopePath = '/ai'

export function workspaceHeaders(workspace: Workspace): Record<string, string> {
  return { 'X-Workspace-ID': workspace.workspace_id }
}

/**
 * All AgentScope calls go through the app API client so auth, JSON errors and
 * the configured VITE_API_BASE_URL stay consistent with the rest of the app.
 */
export function agentScopeRequest<T>(
  path: string,
  init: ApiRequestInit = {}
): Promise<T> {
  return api<T>(path, init)
}

export function agentScopeStreamUrl(
  sessionId: string,
  agentId: string
): string {
  const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(
    /\/$/,
    ''
  )
  return `${apiBase}${agentScopePath}/sessions/${encodeURIComponent(sessionId)}/stream?agent_id=${encodeURIComponent(agentId)}`
}

export function listAgentScopeCredentials(workspace: Workspace) {
  return agentScopeRequest<{ credentials: AgentScopeCredential[] }>(
    `${agentScopePath}/credential/`,
    { headers: workspaceHeaders(workspace) }
  )
}

export function listModelsForCredential(
  workspace: Workspace,
  provider: string,
  kind: 'chat' | 'tts'
) {
  const path = kind === 'chat' ? '/model/' : '/tts-model/'
  return agentScopeRequest<{ models: ModelCard[]; total: number }>(
    `${agentScopePath}${path}?provider=${encodeURIComponent(provider)}`,
    { headers: workspaceHeaders(workspace) }
  )
}

/**
 * Mirrors AgentScope's grouped model hooks: one credential list, then one
 * provider model list per credential. Individual provider failures do not
 * hide the other credentials.
 */
export async function listCredentialModelGroups(
  workspace: Workspace,
  kind: 'chat' | 'tts'
): Promise<Record<string, CredentialWithModels[]>> {
  const { credentials } = await listAgentScopeCredentials(workspace)
  const groups: Record<string, CredentialWithModels[]> = {}
  await Promise.all(
    credentials.map(async (credential) => {
      const provider = credential.data.type
      if (!provider) return
      groups[provider] ??= []
      try {
        const { models } = await listModelsForCredential(
          workspace,
          provider,
          kind
        )
        const usable =
          kind === 'tts'
            ? models.filter((model) => model.name || model.label)
            : [...models].sort((left, right) =>
                right.name.localeCompare(left.name, undefined, {
                  numeric: true,
                })
              )
        groups[provider].push({ credential, models: usable })
      } catch {
        groups[provider].push({ credential, models: [] })
      }
    })
  )
  for (const [provider, entries] of Object.entries(groups)) {
    if (kind === 'tts' && !entries.some(({ models }) => models.length))
      delete groups[provider]
  }
  return groups
}

export function listRealtimeModelsForCredential(
  workspace: Workspace,
  provider: string
) {
  return agentScopeRequest<{ models: RealtimeModelCard[]; total: number }>(
    `${agentScopePath}/realtime/models?provider=${encodeURIComponent(provider)}`,
    { headers: workspaceHeaders(workspace) }
  )
}

/**
 * Realtime models use the same workspace credentials as chat and TTS, but
 * AgentScope exposes them through a separate provider endpoint.
 */
export async function listRealtimeModelGroups(
  workspace: Workspace
): Promise<Record<string, CredentialWithRealtimeModels[]>> {
  const { credentials } = await listAgentScopeCredentials(workspace)
  const groups: Record<string, CredentialWithRealtimeModels[]> = {}
  await Promise.all(
    credentials.map(async (credential) => {
      const provider = credential.data.type
      if (!provider) return
      groups[provider] ??= []
      try {
        const { models } = await listRealtimeModelsForCredential(
          workspace,
          provider
        )
        groups[provider].push({ credential, models })
      } catch {
        groups[provider].push({ credential, models: [] })
      }
    })
  )
  return groups
}

export function listKnowledgeMiddlewareSchema(workspace: Workspace) {
  return agentScopeRequest<{ parameter_schema: JSONSchema }>(
    `${agentScopePath}/knowledge_bases/middleware/parameters_schema`,
    { headers: workspaceHeaders(workspace) }
  ).then((response) => response.parameter_schema)
}

const sessionQuery = (agentId: string, sessionId: string) =>
  `agent_id=${encodeURIComponent(agentId)}&session_id=${encodeURIComponent(sessionId)}`

export function listSessionMcps(
  workspace: Workspace,
  agentId: string,
  sessionId: string
) {
  return agentScopeRequest<SessionMcp[]>(
    `${agentScopePath}/workspace/mcp?${sessionQuery(agentId, sessionId)}`,
    { headers: workspaceHeaders(workspace) }
  )
}

export async function addSessionMcpsFromLibrary(
  workspace: Workspace,
  agentId: string,
  sessionId: string,
  ids: string[]
) {
  const result = await agentScopeRequest<{
    added: string[]
    failed: Record<string, string>
  }>(
    `${agentScopePath}/workspace/mcp/from-library?${sessionQuery(agentId, sessionId)}`,
    {
      method: 'POST',
      headers: workspaceHeaders(workspace),
      body: JSON.stringify({ mcp_ids: ids }),
    }
  )
  const failures = Object.entries(result.failed)
  if (failures.length)
    throw new Error(
      failures.map(([name, reason]) => `${name}: ${reason}`).join('\n')
    )
  return result
}

export function removeSessionMcp(
  workspace: Workspace,
  agentId: string,
  sessionId: string,
  name: string
) {
  return agentScopeRequest<void>(
    `${agentScopePath}/workspace/mcp/${encodeURIComponent(name)}?${sessionQuery(agentId, sessionId)}`,
    { method: 'DELETE', headers: workspaceHeaders(workspace) }
  )
}

export function listSessionSkills(
  workspace: Workspace,
  agentId: string,
  sessionId: string
) {
  return agentScopeRequest<SessionSkill[]>(
    `${agentScopePath}/workspace/skill?${sessionQuery(agentId, sessionId)}`,
    { headers: workspaceHeaders(workspace) }
  )
}

export async function addSessionSkillsFromLibrary(
  workspace: Workspace,
  agentId: string,
  sessionId: string,
  ids: string[]
) {
  const result = await agentScopeRequest<{
    added: string[]
    failed: Record<string, string>
  }>(
    `${agentScopePath}/workspace/skill/from-library?${sessionQuery(agentId, sessionId)}`,
    {
      method: 'POST',
      headers: workspaceHeaders(workspace),
      body: JSON.stringify({ skill_ids: ids }),
    }
  )
  const failures = Object.entries(result.failed)
  if (failures.length)
    throw new Error(
      failures.map(([name, reason]) => `${name}: ${reason}`).join('\n')
    )
  return result
}

export function removeSessionSkill(
  workspace: Workspace,
  agentId: string,
  sessionId: string,
  name: string
) {
  return agentScopeRequest<void>(
    `${agentScopePath}/workspace/skill/${encodeURIComponent(name)}?${sessionQuery(agentId, sessionId)}`,
    { method: 'DELETE', headers: workspaceHeaders(workspace) }
  )
}
