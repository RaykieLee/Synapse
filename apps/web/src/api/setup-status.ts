import { api, ApiProblem } from '@/lib/api'

export type HealthComponentStatus = 'ok' | 'not_ready' | 'disabled'

export type SynapseHealthResponse = {
  status: 'ok'
  service: string
}

export type AgentScopeHealthResponse = {
  status: 'ok' | 'not_ready'
  version: string
  components: Record<string, HealthComponentStatus>
}

export type ProbeState = 'ok' | 'error' | 'unavailable'

export type ProbeResult<T> = {
  state: ProbeState
  data?: T
  error?: string
}

export type SetupStatus = {
  checkedAt: string
  workspaceId?: string
  synapseApi: ProbeResult<SynapseHealthResponse>
  agentScope: ProbeResult<AgentScopeHealthResponse>
}

function workspaceHeaders(workspaceId: string) {
  return { 'X-Workspace-ID': workspaceId }
}

export function getSynapseHealth() {
  return api<SynapseHealthResponse>('/health').then((health) => {
    if (health?.status !== 'ok' || typeof health.service !== 'string') {
      throw new Error('Synapse 健康端点返回了无法识别的响应。')
    }
    return health
  })
}

export function getAgentScopeHealth(workspaceId: string) {
  return api<AgentScopeHealthResponse>('/ai/health', {
    headers: workspaceHeaders(workspaceId),
  }).then((health) => {
    const validStatuses = new Set<HealthComponentStatus>([
      'ok',
      'not_ready',
      'disabled',
    ])
    if (
      !health ||
      !['ok', 'not_ready'].includes(health.status) ||
      typeof health.version !== 'string' ||
      !health.components ||
      typeof health.components !== 'object' ||
      Object.values(health.components).some(
        (status) => !validStatuses.has(status)
      )
    ) {
      throw new Error('AgentScope 健康端点返回了无法识别的响应。')
    }
    return health
  })
}

function errorMessage(error: unknown) {
  if (error instanceof ApiProblem) {
    return error.code
      ? `${error.code}: ${error.message}`
      : error.message
  }
  return error instanceof Error ? error.message : '检查失败，请稍后重试。'
}

function settledResult<T>(
  result: PromiseSettledResult<T>
): ProbeResult<T> {
  if (result.status === 'fulfilled') {
    return { state: 'ok', data: result.value }
  }
  return { state: 'error', error: errorMessage(result.reason) }
}

export async function probeSetupStatus(
  workspaceId?: string
): Promise<SetupStatus> {
  const [synapseResult, agentScopeResult] = await Promise.allSettled([
    getSynapseHealth(),
    workspaceId
      ? getAgentScopeHealth(workspaceId)
      : Promise.reject(
          new Error(
            '当前账号没有可用 Workspace，无法检查 AgentScope 运行状态。'
          )
        ),
  ])

  return {
    checkedAt: new Date().toISOString(),
    ...(workspaceId ? { workspaceId } : {}),
    synapseApi: settledResult(synapseResult),
    agentScope: workspaceId
      ? settledResult(agentScopeResult)
      : {
          state: 'unavailable',
          error: '当前账号没有可用 Workspace，无法检查 AgentScope 运行状态。',
        },
  }
}
