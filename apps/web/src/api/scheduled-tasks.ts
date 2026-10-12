import { api } from '@/lib/api'

export type ScheduledTaskScheduleType = 'cron' | 'interval'
export type ScheduledTaskIntervalUnit =
  | 'seconds'
  | 'minutes'
  | 'hours'
  | 'days'
  | 'weeks'
export type ScheduledTaskRunStatus = 'running' | 'succeeded' | 'failed'

export type Task = {
  task_id: string
  tenant_id: string
  task_name: string
  description: string | null
  execution_target: string
  parameters: Record<string, string | number | boolean | null>
  schedule_type: ScheduledTaskScheduleType
  cron_expression: string | null
  interval_value: number | null
  interval_unit: ScheduledTaskIntervalUnit | null
  timezone: string
  enabled: boolean
  created_by?: string
  updated_by?: string
  created_at: string
  updated_at: string
}

export type TaskPage = {
  items: Task[]
  total: number
  page: number
  page_size: number
}

export type Target = {
  target_id: string
  name: string
  description: string
  scope: string
}

export type TargetPage = {
  items: Target[]
}

export type TaskRun = {
  run_id: string
  tenant_id: string
  task_id: string
  slot_at: string
  execution_target: string
  started_at: string
  finished_at: string | null
  status: ScheduledTaskRunStatus
  result_summary: Record<string, unknown> | null
  error_code: string | null
}

export type RunPage = {
  items: TaskRun[]
  total: number
  page: number
  page_size: number
}

export type ScheduledTaskListParams = {
  page?: number
  pageSize?: number
  taskName?: string
  executionTarget?: string
  scheduleType?: ScheduledTaskScheduleType
  enabled?: boolean
}

export type ScheduledTaskCreatePayload = {
  task_name: string
  description?: string | null
  execution_target: string
  parameters: Record<string, string | number | boolean | null>
  schedule_type: ScheduledTaskScheduleType
  cron_expression?: string | null
  interval_value?: number | null
  interval_unit?: ScheduledTaskIntervalUnit | null
  timezone: string
  enabled?: boolean
}

export type ScheduledTaskPatchPayload = Partial<
  Omit<ScheduledTaskCreatePayload, 'enabled'>
> & {
  enabled?: boolean
}

export type ScheduledTaskRunListParams = {
  page?: number
  pageSize?: number
  status?: ScheduledTaskRunStatus
  startedFrom?: string
  startedTo?: string
}

function withQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined>
) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

export function listScheduledTasks(
  tenantId: string,
  params: ScheduledTaskListParams = {}
) {
  return api<TaskPage>(
    withQuery(`/tenants/${tenantId}/scheduled-tasks`, {
      page: params.page,
      page_size: params.pageSize,
      task_name: params.taskName,
      execution_target: params.executionTarget,
      schedule_type: params.scheduleType,
      enabled: params.enabled,
    })
  )
}

export function listScheduledTaskTargets(tenantId: string) {
  return api<TargetPage>(`/tenants/${tenantId}/scheduled-tasks/targets`)
}

export function createScheduledTask(
  tenantId: string,
  payload: ScheduledTaskCreatePayload
) {
  return api<Task>(`/tenants/${tenantId}/scheduled-tasks`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateScheduledTask(
  tenantId: string,
  taskId: string,
  payload: ScheduledTaskPatchPayload
) {
  return api<Task>(`/tenants/${tenantId}/scheduled-tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteScheduledTask(tenantId: string, taskId: string) {
  return api<void>(`/tenants/${tenantId}/scheduled-tasks/${taskId}`, {
    method: 'DELETE',
  })
}

export function triggerScheduledTask(tenantId: string, taskId: string) {
  return api<TaskRun>(
    `/tenants/${tenantId}/scheduled-tasks/${taskId}/runs`,
    { method: 'POST' }
  )
}

export function listScheduledTaskRuns(
  tenantId: string,
  taskId: string,
  params: ScheduledTaskRunListParams = {}
) {
  return api<RunPage>(
    withQuery(`/tenants/${tenantId}/scheduled-tasks/${taskId}/runs`, {
      page: params.page,
      page_size: params.pageSize,
      status: params.status,
      started_from: params.startedFrom,
      started_to: params.startedTo,
    })
  )
}

export function getScheduledTaskRun(
  tenantId: string,
  taskId: string,
  runId: string
) {
  return api<TaskRun>(
    `/tenants/${tenantId}/scheduled-tasks/${taskId}/runs/${runId}`
  )
}
