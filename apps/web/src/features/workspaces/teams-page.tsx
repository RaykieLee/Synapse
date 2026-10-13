import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Bot, CircleStop, Loader2, Plus, Users } from 'lucide-react'
import {
  createTeam,
  getTeamRun,
  interruptTeamRun,
  listTeamEvents,
  listTeams,
  startTeamRun,
} from '@/api/team-orchestration'
import { api, ApiProblem } from '@/lib/api'
import { useLocaleText } from '@/lib/i18n'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { LocalizedText } from '@/components/localized-text'
import { useWorkspace } from './context'
import type { Workspace } from './types'

type Agent = { id: string; data: { name: string } }
type RunReference = {
  runId?: string
  requestKey?: string
  teamVersion?: number
}

function key(
  actorId: string,
  workspace: Workspace,
  ...resource: (string | undefined)[]
) {
  return [
    'synapse',
    actorId,
    workspace.tenant_id,
    workspace.workspace_id,
    'teams',
    workspace.membership_version ?? 0,
    ...resource,
  ] as const
}

const statusLabels: Record<string, string> = {
  draft: '草稿',
  ready: '就绪',
  archived: '已归档',
  preparing: '准备中',
  running: '运行中',
  pending: '待处理',
  waiting: '等待确认',
  succeeded: '已完成',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
  interrupt_requested: '中断请求已提交，等待执行器确认',
}
const eventLabels: Record<string, string> = {
  run_preparing: '控制记录准备中',
  run_started: '控制记录已创建',
  interrupt_requested: '中断请求已发送',
  run_interrupted: '已中断',
  run_completed: '已完成',
  run_failed: '失败',
}

function permissionError(error: unknown) {
  return error instanceof ApiProblem && [401, 403].includes(error.status)
}

function errorLabel(error: unknown, fallback: string) {
  if (!(error instanceof ApiProblem)) return fallback
  if (error.status === 401) return '登录已失效，请重新登录。'
  if (error.status === 403) return '当前 Workspace 无权访问或操作此资源。'
  if (error.status === 404) return '团队或运行不存在，可能已归档或删除。'
  if (error.code === 'RUN_ALREADY_ACTIVE')
    return '团队已有活动运行，请查看已有运行。'
  if (error.status === 409 && error.code === 'CONFLICT')
    return '你已创建同名团队，请更换团队名称。'
  if (error.status === 409) return '配置或运行已更新，请加载最新状态后重试。'
  if (error.status === 422) return '请检查团队名称、智能体和任务配置。'
  if (error.status === 429) return '请求过于频繁，请稍后重试。'
  if (error.status === 0) return '无法连接服务器，请检查网络后重试。'
  if (error.status >= 500) return '服务暂不可用，请稍后重试。'
  return fallback
}

function QueryError({
  error,
  fallback,
  retryLabel,
  pending,
  disabled = false,
  retry,
}: {
  error: unknown
  fallback: string
  retryLabel: string
  pending: boolean
  disabled?: boolean
  retry: () => void
}) {
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        <p>
          <LocalizedText text={errorLabel(error, fallback)} />
        </p>
        <Button
          type='button'
          variant='outline'
          disabled={pending || disabled}
          onClick={retry}
        >
          <LocalizedText text={pending ? '正在加载…' : retryLabel} />
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function readRunReferences(storageKey: string): Record<string, RunReference> {
  try {
    const saved: unknown = JSON.parse(
      sessionStorage.getItem(storageKey) ?? '{}'
    )
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
    return Object.fromEntries(
      Object.entries(saved).filter(
        ([, value]) =>
          value &&
          typeof value === 'object' &&
          (!('runId' in value) || typeof value.runId === 'string') &&
          (!('requestKey' in value) || typeof value.requestKey === 'string') &&
          (!('teamVersion' in value) || typeof value.teamVersion === 'number')
      )
    )
  } catch {
    return {}
  }
}

function saveRunReferences(
  storageKey: string,
  references: Record<string, RunReference>
) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(references))
  } catch {
    /* Storage may be disabled. */
  }
}

export function WorkspaceTeamsPage() {
  const { workspace, actorId } = useWorkspace()
  return (
    <TeamsPage
      key={JSON.stringify([
        actorId,
        workspace.tenant_id,
        workspace.workspace_id,
        workspace.membership_version ?? 0,
      ])}
      workspace={workspace}
      actorId={actorId}
    />
  )
}

function TeamsPage({
  workspace,
  actorId,
}: {
  workspace: Workspace
  actorId: string
}) {
  const t = useLocaleText()
  const client = useQueryClient()
  const scope = key(actorId, workspace)
  const storageKey = `synapse:team-runs:${JSON.stringify(scope)}`
  const [references, setReferences] = React.useState(() =>
    readRunReferences(storageKey)
  )
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [taskSubject, setTaskSubject] = React.useState('')
  const [agentId, setAgentId] = React.useState('')
  const [confirmInterrupt, setConfirmInterrupt] = React.useState(false)
  const interruptButton = React.useRef<HTMLButtonElement>(null)
  const cancelButton = React.useRef<HTMLButtonElement>(null)
  const statusSummary = React.useRef<HTMLParagraphElement>(null)
  const manager =
    workspace.status === 'active' &&
    ['owner', 'admin'].includes(workspace.workspace_role)

  React.useEffect(() => {
    saveRunReferences(storageKey, references)
  }, [references, storageKey])

  const teams = useQuery({
    queryKey: key(actorId, workspace, 'list'),
    queryFn: () => listTeams(workspace.workspace_id),
    retry: false,
  })
  const selected = permissionError(teams.error)
    ? null
    : (teams.data?.items.find((team) => team.team_id === selectedId) ??
      teams.data?.items[0] ??
      null)
  const runId = selected ? references[selected.team_id]?.runId : undefined
  const runKey = key(actorId, workspace, 'run', selected?.team_id, runId)
  const runQuery = useQuery({
    queryKey: runKey,
    queryFn: () =>
      getTeamRun(workspace.workspace_id, selected!.team_id, runId!),
    enabled: Boolean(selected && runId),
    retry: false,
    refetchInterval: (query) =>
      query.state.error
        ? false
        : ['running', 'preparing', 'interrupt_requested'].includes(
              query.state.data?.status ?? ''
            )
          ? 3000
          : false,
  })
  const run = permissionError(runQuery.error) ? undefined : runQuery.data
  const eventsKey = key(actorId, workspace, 'events', selected?.team_id, runId)
  const events = useQuery({
    queryKey: eventsKey,
    queryFn: () =>
      listTeamEvents(workspace.workspace_id, selected!.team_id, runId!),
    enabled: Boolean(selected && run),
    retry: false,
    refetchInterval: (query) =>
      query.state.error
        ? false
        : run &&
            ['running', 'preparing', 'interrupt_requested'].includes(run.status)
          ? 3000
          : false,
  })
  const agents = useQuery({
    queryKey: key(actorId, workspace, 'agents'),
    queryFn: () =>
      api<{ agents: Agent[] }>('/ai/agent/', {
        headers: { 'X-Workspace-ID': workspace.workspace_id },
      }),
    enabled: manager && !permissionError(teams.error),
    retry: false,
  })

  const create = useMutation({
    mutationFn: () => {
      if (
        !manager ||
        !agents.data?.agents.some((agent) => agent.id === agentId)
      )
        throw new Error('TEAM_CREATE_UNAVAILABLE')
      return createTeam(workspace.workspace_id, {
        name: name.trim(),
        description: description.trim(),
        members: [{ agent_id: agentId, role: 'leader', is_leader: true }],
        tasks: [
          {
            task_id: `task_${crypto.randomUUID()}`,
            subject: taskSubject.trim(),
            description: '',
            owner_member_id: agentId,
            depends_on: [],
            allow_failure: false,
          },
        ],
      })
    },
    onSuccess: async (team) => {
      setName('')
      setDescription('')
      setTaskSubject('')
      setAgentId('')
      setSelectedId(team.team_id)
      await client.invalidateQueries({ queryKey: [...scope, 'list'] })
    },
  })
  const start = useMutation({
    mutationFn: (request: {
      teamId: string
      teamVersion: number
      requestKey: string
    }) =>
      startTeamRun(
        workspace.workspace_id,
        request.teamId,
        request.teamVersion,
        request.requestKey
      ),
    onSuccess: (accepted) => {
      setReferences((previous) => ({
        ...previous,
        [accepted.team_id]: {
          ...previous[accepted.team_id],
          runId: accepted.team_run_id,
        },
      }))
    },
    onError: (error) => {
      if (error instanceof ApiProblem && error.status === 409)
        void client.invalidateQueries({ queryKey: [...scope, 'list'] })
    },
  })
  const interrupt = useMutation({
    mutationFn: (request: {
      teamId: string
      runId: string
      runVersion: number
    }) =>
      interruptTeamRun(
        workspace.workspace_id,
        request.teamId,
        request.runId,
        request.runVersion
      ),
    onSuccess: (snapshot) => {
      client.setQueryData(runKey, snapshot)
      setConfirmInterrupt(false)
      void client.invalidateQueries({ queryKey: eventsKey })
    },
    onError: (error) => {
      if (error instanceof ApiProblem && error.status === 409)
        void client.invalidateQueries({ queryKey: runKey })
    },
  })
  // Phase 1 context exposes roles, not custom team grants. A run capability alone cannot grant actor permission.
  const canManage =
    manager &&
    ![
      teams.error,
      agents.error,
      runQuery.error,
      events.error,
      create.error,
      start.error,
      interrupt.error,
    ].some(permissionError)
  const busy = create.isPending || start.isPending || interrupt.isPending
  const canStart =
    canManage &&
    Boolean(selected?.members.length && selected.tasks.length) &&
    selected?.status === 'draft' &&
    !runId &&
    !teams.isError
  const canInterrupt =
    canManage &&
    run?.capabilities.can_interrupt === true &&
    ['preparing', 'running'].includes(run.status)

  function startRun() {
    if (!canStart || !selected || busy) return
    const saved = references[selected.team_id]
    const requestKey =
      saved?.teamVersion === selected.version && saved.requestKey
        ? saved.requestKey
        : `web-${crypto.randomUUID()}`
    const next = {
      ...references,
      [selected.team_id]: { requestKey, teamVersion: selected.version },
    }
    // Save the key before POST so a lost response or page reload can retry the same logical start.
    saveRunReferences(storageKey, next)
    setReferences(next)
    start.mutate({
      teamId: selected.team_id,
      teamVersion: selected.version,
      requestKey,
    })
  }

  const controlOnly = !run || run.execution_mode === 'durable_control_only'
  const runStatus =
    run?.status === 'running' && controlOnly
      ? '控制状态已保存'
      : (statusLabels[run?.status ?? selected?.status ?? 'draft'] ?? '未知状态')
  const tasks = run?.tasks ?? selected?.tasks ?? []
  const percent = Math.min(100, Math.max(0, run?.progress.percent ?? 0))

  return (
    <main className='min-w-0 space-y-6 p-4 sm:p-6'>
      <header className='flex flex-wrap items-start justify-between gap-4'>
        <div className='min-w-0'>
          <Link
            className='inline-flex items-center gap-1 text-sm underline underline-offset-4'
            to='/w/$workspaceId'
            params={{ workspaceId: workspace.workspace_id }}
          >
            <ArrowLeft className='size-3.5' aria-hidden />
            <LocalizedText text='返回空间' />
          </Link>
          <p className='mt-3 text-sm break-words text-muted-foreground'>
            <LocalizedText text='Workspace' /> · {workspace.name}
          </p>
          <h1 className='mt-1 text-2xl font-semibold'>
            <LocalizedText text='子智能体团队' />
          </h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            <LocalizedText text='创建团队草稿、定义任务，并查看可审计的运行快照。' />
          </p>
        </div>
        <Button asChild variant='outline'>
          <Link
            to='/w/$workspaceId/sessions'
            params={{ workspaceId: workspace.workspace_id }}
          >
            <Bot className='mr-2 size-4' aria-hidden />
            <LocalizedText text='会话管理' />
          </Link>
        </Button>
      </header>

      <Alert role='note'>
        <AlertDescription>
          <p className='font-medium'>
            <LocalizedText text='仅记录控制请求' /> /{' '}
            <LocalizedText text='执行服务未接入' />
          </p>
          <p>
            <LocalizedText text='当前阶段只持久化团队配置、运行快照和控制请求，不会执行模型或任务。' />
          </p>
        </AlertDescription>
      </Alert>
      {!canManage && (
        <p role='note' className='text-sm text-muted-foreground'>
          <LocalizedText
            text={
              workspace.status !== 'active'
                ? '此 Workspace 已归档，团队仅可查看。'
                : '当前 Workspace 无权管理团队；可查看团队和运行快照。'
            }
          />
        </p>
      )}
      {!canManage && permissionError(interrupt.error) && (
        <Alert variant='destructive'>
          <AlertDescription>
            <LocalizedText
              text={errorLabel(interrupt.error, '中断请求提交失败，请重试。')}
            />
          </AlertDescription>
        </Alert>
      )}

      <div className='grid min-w-0 gap-5 xl:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)]'>
        <Card className='min-w-0 self-start'>
          <CardHeader>
            <CardTitle>
              <LocalizedText text='团队列表' />
            </CardTitle>
            {teams.data && (
              <CardDescription>
                {teams.data.total} <LocalizedText text='个团队' />
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className='space-y-2' aria-busy={teams.isFetching}>
            {teams.isLoading && (
              <p role='status'>
                <LocalizedText text='正在加载团队…' />
              </p>
            )}
            {teams.isError && (
              <QueryError
                error={teams.error}
                fallback='加载团队失败。'
                retryLabel='重新加载团队'
                pending={teams.isFetching}
                retry={() => {
                  void teams.refetch()
                }}
              />
            )}
            {!permissionError(teams.error) &&
              teams.data?.items.map((team) => (
                <button
                  key={team.team_id}
                  type='button'
                  disabled={busy}
                  aria-pressed={selected?.team_id === team.team_id}
                  onClick={() => {
                    setSelectedId(team.team_id)
                    start.reset()
                    interrupt.reset()
                    setConfirmInterrupt(false)
                  }}
                  className={`w-full min-w-0 rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 ${selected?.team_id === team.team_id ? 'border-primary bg-accent' : 'hover:bg-accent'}`}
                >
                  <span className='flex flex-wrap justify-between gap-2 font-medium'>
                    <span className='min-w-0 break-all'>{team.name}</span>
                    <span className='text-xs text-muted-foreground'>
                      <LocalizedText
                        text={statusLabels[team.status] ?? '未知状态'}
                      />
                    </span>
                  </span>
                  <span className='mt-1 block text-xs text-muted-foreground'>
                    {team.members.length} <LocalizedText text='成员' /> ·{' '}
                    {team.tasks.length} <LocalizedText text='任务' /> · v
                    {team.version}
                  </span>
                </button>
              ))}
            {teams.isSuccess && !teams.data.items.length && (
              <p className='rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground'>
                <LocalizedText text='当前 Workspace 还没有团队。' />
              </p>
            )}
          </CardContent>
        </Card>

        <div className='min-w-0 space-y-5'>
          {canManage && (
            <Card className='min-w-0'>
              <CardHeader>
                <CardTitle>
                  <Plus className='mr-2 inline size-4' aria-hidden />
                  <LocalizedText text='创建团队草稿' />
                </CardTitle>
                <CardDescription>
                  <LocalizedText text='首期只允许使用当前 Workspace 可见的智能体；保存不会启动模型。' />
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-3'>
                {agents.isLoading && (
                  <p role='status'>
                    <LocalizedText text='正在加载智能体…' />
                  </p>
                )}
                {agents.isError && (
                  <QueryError
                    error={agents.error}
                    fallback='加载智能体失败。'
                    retryLabel='重新加载智能体'
                    pending={agents.isFetching}
                    retry={() => {
                      void agents.refetch()
                    }}
                  />
                )}
                {agents.isSuccess && !agents.data.agents.length && (
                  <p>
                    <LocalizedText text='请先在智能体管理中创建智能体。' />
                  </p>
                )}
                {create.isError && (
                  <Alert variant='destructive'>
                    <AlertDescription>
                      <LocalizedText
                        text={errorLabel(
                          create.error,
                          '创建团队失败，请检查配置后重试。'
                        )}
                      />
                    </AlertDescription>
                  </Alert>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (
                      !busy &&
                      canManage &&
                      agentId &&
                      name.trim() &&
                      taskSubject.trim() &&
                      !agents.isError
                    )
                      create.mutate()
                  }}
                >
                  <fieldset
                    disabled={busy || !agents.isSuccess}
                    className='grid min-w-0 gap-3 sm:grid-cols-2'
                  >
                    <div className='space-y-2'>
                      <Label htmlFor='team-name'>
                        <LocalizedText text='团队名称' />
                      </Label>
                      <Input
                        id='team-name'
                        required
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        maxLength={100}
                      />
                    </div>
                    <div className='min-w-0 space-y-2'>
                      <Label htmlFor='team-agent'>
                        <LocalizedText text='负责人智能体' />
                      </Label>
                      <select
                        id='team-agent'
                        required
                        className='h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm'
                        value={agentId}
                        onChange={(event) => setAgentId(event.target.value)}
                      >
                        <option value=''>
                          <LocalizedText text='请选择' />
                        </option>
                        {agents.data?.agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.data.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className='space-y-2 sm:col-span-2'>
                      <Label htmlFor='team-description'>
                        <LocalizedText text='团队说明' />
                      </Label>
                      <Textarea
                        id='team-description'
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        maxLength={4000}
                      />
                    </div>
                    <div className='space-y-2 sm:col-span-2'>
                      <Label htmlFor='team-task'>
                        <LocalizedText text='首个任务' />
                      </Label>
                      <Input
                        id='team-task'
                        required
                        value={taskSubject}
                        onChange={(event) => setTaskSubject(event.target.value)}
                        maxLength={200}
                        placeholder={t('例如：整理产品竞品背景')}
                      />
                    </div>
                    <div className='sm:col-span-2'>
                      <Button
                        type='submit'
                        className='w-full sm:w-auto'
                        disabled={
                          busy ||
                          !name.trim() ||
                          !taskSubject.trim() ||
                          !agents.data?.agents.some(
                            (agent) => agent.id === agentId
                          )
                        }
                      >
                        {create.isPending ? (
                          <Loader2
                            className='size-4 animate-spin motion-reduce:animate-none'
                            aria-hidden
                          />
                        ) : (
                          <Plus className='size-4' aria-hidden />
                        )}
                        <LocalizedText
                          text={create.isPending ? '正在创建草稿…' : '创建草稿'}
                        />
                      </Button>
                    </div>
                  </fieldset>
                </form>
              </CardContent>
            </Card>
          )}

          {selected && (
            <Card className='min-w-0'>
              <CardHeader>
                <CardTitle className='break-all'>{selected.name}</CardTitle>
                <CardDescription className='break-words'>
                  {selected.description || <LocalizedText text='无团队说明' />}
                </CardDescription>
              </CardHeader>
              <CardContent className='min-w-0 space-y-4'>
                {runId && runQuery.isLoading && (
                  <p role='status'>
                    <LocalizedText text='正在加载运行快照…' />
                  </p>
                )}
                {runId && runQuery.isError && (
                  <QueryError
                    error={runQuery.error}
                    fallback='加载运行失败。'
                    retryLabel='重新加载运行'
                    pending={runQuery.isFetching}
                    retry={() => {
                      void runQuery.refetch()
                    }}
                  />
                )}
                <div className='grid gap-3 sm:grid-cols-2'>
                  <div>
                    <p className='text-xs text-muted-foreground'>
                      <LocalizedText text='状态' />
                    </p>
                    <p
                      ref={statusSummary}
                      tabIndex={-1}
                      role='status'
                      aria-live='polite'
                      className='mt-1 font-medium break-words'
                    >
                      <LocalizedText
                        text={runId && !run ? '等待运行快照' : runStatus}
                      />
                    </p>
                  </div>
                  <div>
                    <p className='text-xs text-muted-foreground'>
                      <LocalizedText text='版本' />
                    </p>
                    <p className='mt-1 text-sm'>
                      <LocalizedText text='团队版本' /> v{selected.version}
                      {run && (
                        <>
                          {' '}
                          · <LocalizedText text='运行版本' /> v{run.run_version}
                        </>
                      )}
                    </p>
                  </div>
                </div>
                {run?.status === 'interrupt_requested' && (
                  <p className='rounded-md border p-3 text-sm'>
                    <LocalizedText text='中断请求尚未确认，不能视为任务已停止。当前未接入执行器。' />
                  </p>
                )}
                <section aria-label={t('团队成员')} className='space-y-2'>
                  <h3 className='font-medium'>
                    <LocalizedText text='团队成员' />
                  </h3>
                  {selected.members.map((member) => (
                    <div
                      key={member.member_id}
                      className='min-w-0 space-y-1 rounded-lg border p-3 text-sm'
                    >
                      <p className='flex items-start gap-2'>
                        <Users
                          className='size-4 shrink-0 text-muted-foreground'
                          aria-hidden
                        />
                        <span className='min-w-0 break-all'>
                          {member.agent_id}
                        </span>
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        <LocalizedText
                          text={member.is_leader ? '负责人' : '成员'}
                        />
                        {run && (
                          <>
                            {' '}
                            ·{' '}
                            <LocalizedText
                              text={
                                statusLabels[
                                  run.members.find(
                                    (item) =>
                                      item.member_id === member.member_id
                                  )?.status ?? 'pending'
                                ] ?? '未知状态'
                              }
                            />
                          </>
                        )}
                      </p>
                    </div>
                  ))}
                </section>
                <section aria-label={t('任务进度')} className='space-y-2'>
                  <h3 className='font-medium'>
                    <LocalizedText text='任务进度' />
                  </h3>
                  {run && (
                    <>
                      <p className='text-sm'>
                        {run.progress.succeeded}/{tasks.length}{' '}
                        <LocalizedText text='已完成' /> · {percent}%
                      </p>
                      <div
                        role='progressbar'
                        aria-label={t('任务进度')}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                        aria-valuetext={`${run.progress.succeeded}/${tasks.length} ${t('已完成')} · ${percent}%`}
                        className='h-2 overflow-hidden rounded bg-muted'
                      >
                        <div
                          className='h-full bg-primary'
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </>
                  )}
                  {tasks.map((task) => (
                    <div
                      key={task.task_id}
                      className='min-w-0 space-y-1 rounded-lg border p-3 text-sm'
                    >
                      <div className='flex flex-wrap justify-between gap-2'>
                        <span className='min-w-0 break-all'>
                          {task.subject}
                        </span>
                        <span className='text-xs text-muted-foreground'>
                          <LocalizedText
                            text={
                              statusLabels[task.state ?? 'draft'] ?? '未知状态'
                            }
                          />
                        </span>
                      </div>
                      <p className='text-xs break-all text-muted-foreground'>
                        <LocalizedText text='负责人' />: {task.owner_member_id}
                      </p>
                    </div>
                  ))}
                  {!tasks.length && (
                    <p className='text-sm text-muted-foreground'>
                      <LocalizedText text='至少添加一个任务后才能启动。' />
                    </p>
                  )}
                </section>
                {run && (
                  <section aria-label={t('运行事件')} className='space-y-2'>
                    <h3 className='font-medium'>
                      <LocalizedText text='运行事件' />
                    </h3>
                    <p className='text-xs text-muted-foreground'>
                      <LocalizedText text='当前使用运行快照和事件轮询；尚未接入实时执行流。' />
                    </p>
                    {events.isLoading && (
                      <p role='status'>
                        <LocalizedText text='正在加载事件…' />
                      </p>
                    )}
                    {events.isError && (
                      <QueryError
                        error={events.error}
                        fallback='加载事件失败。'
                        retryLabel='重新加载事件'
                        pending={events.isFetching}
                        retry={() => {
                          void events.refetch()
                        }}
                      />
                    )}
                    {!permissionError(events.error) && (
                      <ol className='max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground'>
                        {events.data?.items.map((event) => (
                          <li key={event.event_id} className='break-all'>
                            <span className='mr-2 font-mono'>
                              #{event.sequence}
                            </span>
                            <LocalizedText
                              text={eventLabels[event.event_type] ?? '其他事件'}
                            />
                          </li>
                        ))}
                      </ol>
                    )}
                    {events.isSuccess && !events.data.items.length && (
                      <p className='text-sm text-muted-foreground'>
                        <LocalizedText text='暂无运行事件。' />
                      </p>
                    )}
                  </section>
                )}
                {start.isError && (
                  <QueryError
                    error={start.error}
                    fallback='启动团队失败，请重试。'
                    retryLabel='重试启动'
                    pending={start.isPending}
                    disabled={!canStart}
                    retry={startRun}
                  />
                )}
                {canManage && (
                  <div className='sticky bottom-0 flex flex-wrap gap-2 border-t bg-card py-3 sm:static'>
                    {!runId && (
                      <Button
                        type='button'
                        className='w-full sm:w-auto'
                        disabled={!canStart || busy}
                        onClick={startRun}
                      >
                        {start.isPending && (
                          <Loader2
                            className='size-4 animate-spin motion-reduce:animate-none'
                            aria-hidden
                          />
                        )}
                        <LocalizedText
                          text={
                            start.isPending ? '正在保存运行…' : '启动团队运行'
                          }
                        />
                      </Button>
                    )}
                    <AlertDialog
                      open={confirmInterrupt && canManage}
                      onOpenChange={(open) => {
                        if (!interrupt.isPending) {
                          setConfirmInterrupt(open)
                          if (open) interrupt.reset()
                        }
                      }}
                    >
                      {canInterrupt && (
                        <AlertDialogTrigger asChild>
                          <Button
                            ref={interruptButton}
                            type='button'
                            variant='destructive'
                            className='w-full sm:w-auto'
                            disabled={busy}
                          >
                            <CircleStop className='size-4' aria-hidden />
                            <LocalizedText text='请求中断运行' />
                          </Button>
                        </AlertDialogTrigger>
                      )}
                      <AlertDialogContent
                        className='max-h-[80vh] overflow-y-auto'
                        onOpenAutoFocus={(event) => {
                          event.preventDefault()
                          cancelButton.current?.focus()
                        }}
                        onCloseAutoFocus={(event) => {
                          event.preventDefault()
                          if (interruptButton.current?.isConnected)
                            interruptButton.current.focus()
                          else statusSummary.current?.focus()
                        }}
                        onEscapeKeyDown={(event) => {
                          if (interrupt.isPending) event.preventDefault()
                        }}
                      >
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            <LocalizedText text='确认请求中断团队运行' />
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            <LocalizedText text='这会保存整个团队运行的中断请求。当前未接入执行器，提交成功不代表成员任务已停止。' />
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <p className='text-sm break-all'>{selected.name}</p>
                        {interrupt.isError && (
                          <Alert variant='destructive'>
                            <AlertDescription>
                              <LocalizedText
                                text={errorLabel(
                                  interrupt.error,
                                  '中断请求提交失败，请重试。'
                                )}
                              />
                            </AlertDescription>
                          </Alert>
                        )}
                        <AlertDialogFooter>
                          <AlertDialogCancel
                            ref={cancelButton}
                            disabled={interrupt.isPending}
                          >
                            <LocalizedText text='取消' />
                          </AlertDialogCancel>
                          <AlertDialogAction
                            className='bg-destructive text-white hover:bg-destructive/90'
                            disabled={!canInterrupt || interrupt.isPending}
                            onClick={(event) => {
                              event.preventDefault()
                              if (canInterrupt && run && !interrupt.isPending)
                                interrupt.mutate({
                                  teamId: selected.team_id,
                                  runId: run.team_run_id,
                                  runVersion: run.run_version,
                                })
                            }}
                          >
                            {interrupt.isPending && (
                              <Loader2
                                className='size-4 animate-spin motion-reduce:animate-none'
                                aria-hidden
                              />
                            )}
                            <LocalizedText
                              text={
                                interrupt.isPending
                                  ? '正在提交中断请求…'
                                  : interrupt.isError
                                    ? '重试中断请求'
                                    : '确认中断请求'
                              }
                            />
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  )
}
