import { api } from '@/lib/api'
import type {
  AgentScopeAgent,
  AgentScopeCredential,
  ApiList,
  ChannelChatId,
  ChannelBindingView,
  ChannelRecord,
  ChannelStatus,
  ChannelTypeSchema,
  AgentScopeModelCard,
  ScheduleRecord,
  SessionRecord,
} from './types'

const aiPath = '/ai'
const workspaceHeaders = (workspaceId: string) => ({
  'X-Workspace-ID': workspaceId,
})

export function listAgents(workspaceId: string) {
  return api<{ agents: AgentScopeAgent[]; total: number }>(`${aiPath}/agent/`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function listCredentials(workspaceId: string) {
  return api<{
    credentials: AgentScopeCredential[]
    total: number
  }>(`${aiPath}/credential/`, { headers: workspaceHeaders(workspaceId) })
}

export function listSchedules(workspaceId: string) {
  return api<{ schedules: ScheduleRecord[]; total: number }>(
    `${aiPath}/schedule/`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

export function createSchedule(
  workspaceId: string,
  body: {
    name: string
    description: string
    cron_expression: string
    timezone: string
    agent_id: string
    chat_model_config: {
      type: string
      credential_id: string
      model: string
      parameters: Record<string, unknown>
    }
    enabled: boolean
    stateful: boolean
    permission_mode: string
  }
) {
  return api<{ schedule_id: string }>(`${aiPath}/schedule/`, {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  })
}

export function listModels(workspaceId: string, provider: string) {
  return api<{ models: AgentScopeModelCard[]; total: number }>(
    `${aiPath}/model/?provider=${encodeURIComponent(provider)}`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

export function updateSchedule(
  workspaceId: string,
  scheduleId: string,
  body: Partial<{
    name: string
    description: string
    cron_expression: string
    timezone: string
    enabled: boolean
    stateful: boolean
    permission_mode: string
  }>
) {
  return api<ScheduleRecord>(`${aiPath}/schedule/${scheduleId}`, {
    method: 'PATCH',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  })
}

export function deleteSchedule(workspaceId: string, scheduleId: string) {
  return api<void>(`${aiPath}/schedule/${scheduleId}`, {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceId),
  })
}

export function listScheduleSessions(workspaceId: string, scheduleId: string) {
  return api<{ sessions: SessionRecord[]; total: number }>(
    `${aiPath}/schedule/${scheduleId}/sessions`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

export function listChannelTypes(workspaceId: string) {
  return api<ChannelTypeSchema[]>(`${aiPath}/channels/types`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function startChannelBinding(workspaceId: string, channelType: string) {
  return api<ChannelBindingView>(`${aiPath}/channels/bindings`, {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify({ channel_type: channelType }),
  })
}

export function pollChannelBinding(workspaceId: string, bindingId: string) {
  return api<ChannelBindingView>(`${aiPath}/channels/bindings/${bindingId}`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function cancelChannelBinding(workspaceId: string, bindingId: string) {
  return api<{ status: string }>(
    `${aiPath}/channels/bindings/${bindingId}/cancel`,
    { method: 'POST', headers: workspaceHeaders(workspaceId) }
  )
}

export function listChannels(workspaceId: string) {
  return api<ChannelRecord[]>(`${aiPath}/channels/`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function createChannel(
  workspaceId: string,
  body: {
    channel_type: string
    name: string | null
    credentials?: Record<string, unknown>
    credential_binding_id?: string | null
    platform_config: Record<string, unknown>
    routing: ChannelRecord['routing']
    session: ChannelRecord['session']
    enabled: boolean
  }
) {
  return api<ChannelRecord>(`${aiPath}/channels/`, {
    method: 'POST',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  })
}

export function updateChannel(
  workspaceId: string,
  channelId: string,
  body: Partial<{
    name: string | null
    platform_config: Record<string, unknown>
    routing: ChannelRecord['routing']
    session: ChannelRecord['session']
    enabled: boolean
  }>
) {
  return api<ChannelRecord>(`${aiPath}/channels/${channelId}`, {
    method: 'PATCH',
    headers: workspaceHeaders(workspaceId),
    body: JSON.stringify(body),
  })
}

export function deleteChannel(workspaceId: string, channelId: string) {
  return api<void>(`${aiPath}/channels/${channelId}`, {
    method: 'DELETE',
    headers: workspaceHeaders(workspaceId),
  })
}

export function setChannelEnabled(
  workspaceId: string,
  channelId: string,
  enabled: boolean
) {
  return api<{ status: string }>(
    `${aiPath}/channels/${channelId}/${enabled ? 'enable' : 'disable'}`,
    { method: 'POST', headers: workspaceHeaders(workspaceId) }
  )
}

export function getChannelStatus(workspaceId: string, channelId: string) {
  return api<ChannelStatus>(`${aiPath}/channels/${channelId}/status`, {
    headers: workspaceHeaders(workspaceId),
  })
}

export function listChannelSessions(workspaceId: string, channelId: string) {
  return api<{ sessions: SessionRecord[]; total: number }>(
    `${aiPath}/channels/${channelId}/sessions`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

export function listChannelChatIds(workspaceId: string, channelId: string) {
  return api<{ chats: ChannelChatId[] }>(
    `${aiPath}/channels/${channelId}/chat_ids`,
    { headers: workspaceHeaders(workspaceId) }
  )
}

export type { ApiList }
