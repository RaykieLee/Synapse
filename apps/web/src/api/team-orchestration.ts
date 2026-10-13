import { api } from '@/lib/api'

export type TeamMember = {
  member_id: string
  agent_id: string
  role: string
  is_leader: boolean
}

export type TeamTask = {
  task_id: string
  subject: string
  description: string
  owner_member_id: string
  depends_on: string[]
  allow_failure: boolean
  state?: string
  attempt?: number
}

export type Team = {
  team_id: string
  workspace_id: string
  tenant_id: string
  name: string
  description: string
  status: 'draft' | 'ready' | 'archived'
  visibility: 'workspace_shared'
  version: number
  created_by: string
  created_at: string
  updated_at: string
  members: TeamMember[]
  tasks: TeamTask[]
}

export type TeamRun = {
  team_run_id: string
  team_id: string
  workspace_id: string
  team_version: number
  run_version: number
  status: string
  progress: {
    succeeded: number
    running: number
    waiting: number
    failed: number
    pending: number
    interrupted: number
    percent: number
  }
  members: Array<{
    member_id: string
    agent_id: string
    status: string
    session_id: string | null
  }>
  tasks: TeamTask[]
  capabilities: {
    can_pause: boolean
    can_resume: boolean
    can_interrupt: boolean
    interrupt_confirmation_pending: boolean
    can_retry: boolean
    can_execute?: boolean
  }
  execution_mode: string
  last_error: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type TeamEvent = {
  event_id: string
  sequence: number
  event_type: string
  team_id: string
  team_run_id: string
  occurred_at: string
  payload: Record<string, unknown>
}

const headers = (workspaceId: string) => ({ 'X-Workspace-ID': workspaceId })
const base = (workspaceId: string) => `/workspaces/${workspaceId}/teams`

export function listTeams(workspaceId: string) {
  return api<{ items: Team[]; total: number }>(base(workspaceId), {
    headers: headers(workspaceId),
  })
}

export function createTeam(
  workspaceId: string,
  body: {
    name: string
    description: string
    members: Array<{ agent_id: string; role: string; is_leader: boolean }>
    tasks: Array<{
      task_id: string
      subject: string
      description: string
      owner_member_id: string
      depends_on: string[]
      allow_failure: boolean
    }>
  }
) {
  return api<Team>(base(workspaceId), {
    method: 'POST',
    headers: headers(workspaceId),
    body: JSON.stringify(body),
  })
}

export function startTeamRun(
  workspaceId: string,
  teamId: string,
  teamVersion: number,
  idempotencyKey = `web-${crypto.randomUUID()}`
) {
  return api<{
    team_id: string
    team_run_id: string
    team_version: number
    run_version: number
    status: string
    accepted_at: string
    execution_mode: string
  }>(`${base(workspaceId)}/${teamId}/runs`, {
    method: 'POST',
    headers: { ...headers(workspaceId), 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ team_version: teamVersion }),
  })
}

export function getTeamRun(workspaceId: string, teamId: string, runId: string) {
  return api<TeamRun>(`${base(workspaceId)}/${teamId}/runs/${runId}`, {
    headers: headers(workspaceId),
  })
}

export function interruptTeamRun(
  workspaceId: string,
  teamId: string,
  runId: string,
  runVersion: number
) {
  return api<TeamRun>(
    `${base(workspaceId)}/${teamId}/runs/${runId}/interrupt`,
    {
      method: 'POST',
      headers: headers(workspaceId),
      body: JSON.stringify({ expected_run_version: runVersion }),
    }
  )
}

export function listTeamEvents(
  workspaceId: string,
  teamId: string,
  runId: string
) {
  return api<{ items: TeamEvent[]; total: number }>(
    `${base(workspaceId)}/${teamId}/runs/${runId}/events`,
    {
      headers: headers(workspaceId),
    }
  )
}
