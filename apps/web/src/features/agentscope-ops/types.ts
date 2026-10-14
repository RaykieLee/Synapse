export type AgentScopeAgent = {
  id: string
  data?: {
    name?: string
  }
  name?: string
}

export type AgentScopeCredential = {
  id: string
  data?: {
    name?: string
    type?: string
  }
  name?: string
}

export type AgentScopeModelCard = {
  name: string
  label?: string
  status?: string
  parameter_schema?: Record<string, unknown>
  [key: string]: unknown
}

export type ChatModelConfig = {
  type: string
  credential_id: string
  model: string
  parameters: Record<string, unknown>
}

export type ScheduleData = {
  name: string
  description: string
  enabled: boolean
  timezone: string
  cron_expression: string
  started_at: string
  ended_at: string | null
  chat_model_config: ChatModelConfig
  stateful: boolean
  permission_mode: string
  source: string
  source_session_id: string
}

export type ScheduleRecord = {
  id: string
  user_id: string
  agent_id: string
  data: ScheduleData
  created_at?: string
  updated_at?: string
}

export type SessionRecord = {
  id: string
  config?: {
    name?: string
  }
  origin?: {
    type?: string
    schedule_id?: string
    channel_id?: string
  }
  created_at?: string
  updated_at?: string
}

export type RoutingBinding = {
  match_key: string
  match_value: string
  agent_id: string
  session_scope: 'per_chat' | 'per_chat_user'
}

export type ChannelRecord = {
  id: string
  channel_type: string
  name: string | null
  user_id: string
  platform_bot_id: string
  enabled: boolean
  platform_config: Record<string, unknown>
  routing: {
    bindings: RoutingBinding[]
  }
  session: {
    chat_model_config: Record<string, unknown>
    fallback_chat_model_config?: Record<string, unknown> | null
    permission_mode: string
  }
  created_at?: string
  updated_at?: string
}

export type ChannelTypeSchema = {
  channel_type: string
  display_name?: string
  description?: string
  supports_credential_binding?: boolean
  credentials_schema?: Record<string, unknown>
  config_schema?: Record<string, unknown>
  [key: string]: unknown
}

export type ChannelBindingState =
  | 'pending'
  | 'authorized'
  | 'failed'
  | 'cancelled'

export type ChannelBindingView = {
  binding_id: string
  state: ChannelBindingState
  verification_url?: string
  error?: string
  retry_after_secs?: number
}

export type ChannelStatus = {
  state?: string
  last_error?: string
  [key: string]: unknown
}

export type ChannelChatId = {
  chat_id: string
  name?: string
  source: string
}

export type ApiList<T> = {
  items?: T[]
  total?: number
}
