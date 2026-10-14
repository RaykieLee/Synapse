export type ModelParameters = Record<string, unknown>

export type ModelConfig = {
  type: string
  credential_id: string
  model: string
  parameters: ModelParameters
}

export type RealtimeModelCard = {
  model_type: string
  name: string
  label?: string
  status?: string
  input_types?: string[]
  output_types?: string[]
  input_sample_rate?: number
  output_sample_rate?: number
  supports_tools?: boolean
  parameter_schema?: unknown
  [key: string]: unknown
}

export type SessionKnowledgeConfig = {
  knowledge_base_ids: string[]
  parameters: ModelParameters
}

export type SessionConfigView = {
  name: string
  workspace_id: string
  cwd?: string | null
  chat_model_config?: ModelConfig | null
  fallback_chat_model_config?: ModelConfig | null
  tts_model_config?: ModelConfig | null
  realtime_model_config?: ModelConfig | null
  knowledge_config?: SessionKnowledgeConfig | null
}

export type AgentScopeCredential = {
  id: string
  data: {
    type?: string
    name?: string
    [key: string]: unknown
  }
}

export type ModelCard = {
  name: string
  label?: string
  status?: string
  input_types?: string[]
  parameter_schema?: unknown
  [key: string]: unknown
}

export type CredentialWithModels = {
  credential: AgentScopeCredential
  models: ModelCard[]
}

export type CredentialWithRealtimeModels = {
  credential: AgentScopeCredential
  models: RealtimeModelCard[]
}

export type JSONSchemaProperty = {
  type?: string
  title?: string
  description?: string
  default?: unknown
  minimum?: number
  maximum?: number
  enum?: unknown[]
  anyOf?: JSONSchemaProperty[]
  [key: string]: unknown
}

export type JSONSchema = {
  title?: string
  description?: string
  properties?: Record<string, JSONSchemaProperty>
  required?: string[]
}

export type SessionMcp = {
  name: string
  is_stateful?: boolean
  is_healthy?: boolean
  error?: string | null
  tools?: Array<{ name: string; description?: string | null }>
  [key: string]: unknown
}

export type SessionSkill = {
  name: string
  description?: string
  dir?: string
  [key: string]: unknown
}

export type LibraryResource = {
  id: string
  name: string
  enabled: boolean
  display_name?: string | null
  description: string
}

export type SessionConfigPatch = Partial<{
  chat_model_config: ModelConfig
  fallback_chat_model_config: ModelConfig | null
  tts_model_config: ModelConfig | null
  realtime_model_config: ModelConfig | null
  knowledge_config: SessionKnowledgeConfig | null
}>
