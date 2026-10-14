import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleSlash2,
  Database,
  RefreshCw,
  Server,
  Wifi,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspaceDirectory } from '@/features/workspaces/directory'
import { useAuthStore } from '@/stores/auth-store'
import {
  probeSetupStatus,
  type AgentScopeHealthResponse,
  type HealthComponentStatus,
  type ProbeState,
  type SetupStatus,
} from '@/api/setup-status'

const panel = 'rounded-xl border bg-card p-5'

const componentLabels: Record<string, string> = {
  storage: 'AgentScope 存储',
  message_bus: '消息总线',
  workspace_manager: '工作空间管理器',
  background_task_manager: '后台任务',
  chat_run_registry: '对话运行注册表',
  scheduler_manager: '调度器',
  resource_access_service: '资源访问服务',
  chat_service: '对话服务',
  session_service: '会话服务',
  mcp_hubs: 'MCP Hub',
  skill_hubs: 'Skill Hub',
  knowledge_base: '知识库服务',
}

const componentDescriptions: Record<string, string> = {
  storage: 'AgentScope 元数据和凭据使用的持久化存储。',
  message_bus: 'AgentScope 会话事件和后台唤醒使用的消息总线。',
  knowledge_base: '知识库能力使用的向量存储（Qdrant）。',
  scheduler_manager: 'AgentScope 调度能力的运行时组件。',
  mcp_hubs: 'MCP Hub 浏览和安装能力。',
  skill_hubs: 'Skill Hub 浏览和安装能力。',
}

type StatusVisual = {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
  icon: typeof CheckCircle2
  className: string
}

function probeVisual(state: ProbeState): StatusVisual {
  if (state === 'ok') {
    return {
      label: '正常',
      variant: 'default',
      icon: CheckCircle2,
      className: 'text-emerald-600 dark:text-emerald-400',
    }
  }
  if (state === 'unavailable') {
    return {
      label: '不可检查',
      variant: 'secondary',
      icon: CircleSlash2,
      className: 'text-muted-foreground',
    }
  }
  return {
    label: '检查失败',
    variant: 'destructive',
    icon: XCircle,
    className: 'text-destructive',
  }
}

function componentState(
  health: AgentScopeHealthResponse | undefined,
  names: string[]
): ProbeState {
  if (!health) return 'unavailable'
  const statuses = names.map((name) => health.components[name])
  if (statuses.some((status) => status === undefined)) return 'error'
  if (statuses.some((status) => status === 'not_ready')) return 'error'
  if (statuses.every((status) => status === 'disabled')) return 'unavailable'
  return 'ok'
}

function componentStatusLabel(status: HealthComponentStatus) {
  if (status === 'ok') return '正常'
  if (status === 'disabled') return '未启用'
  return '未就绪'
}

function formatCheckedAt(value?: string) {
  if (!value) return '尚未检查'
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
}

function RuntimeCard({
  title,
  description,
  state,
  statusLabel,
  icon: Icon,
  detail,
}: {
  title: string
  description: string
  state: ProbeState
  statusLabel?: string
  icon: typeof Server
  detail?: string
}) {
  const visual = probeVisual(state)
  const StatusIcon = visual.icon
  return (
    <Card className='h-full'>
      <CardHeader className='gap-3'>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex items-center gap-3'>
            <div className='flex size-10 items-center justify-center rounded-lg bg-muted'>
              <Icon className='size-5' aria-hidden='true' />
            </div>
            <CardTitle>{title}</CardTitle>
          </div>
          <Badge variant={visual.variant}>
            <StatusIcon className='size-3.5' aria-hidden='true' />
            {statusLabel ?? visual.label}
          </Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {detail && (
        <CardContent className='pt-0 text-sm text-muted-foreground'>
          {detail}
        </CardContent>
      )}
    </Card>
  )
}

function SetupSkeleton() {
  return (
    <div className='grid gap-4 md:grid-cols-2'>
      {[1, 2, 3, 4].map((item) => (
        <Card key={item}>
          <CardHeader>
            <Skeleton className='h-6 w-40' />
            <Skeleton className='h-4 w-full' />
          </CardHeader>
          <CardContent>
            <Skeleton className='h-4 w-28' />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function StatusAlert({ status }: { status: SetupStatus }) {
  const errors = [
    status.synapseApi.error
      ? `Synapse API：${status.synapseApi.error}`
      : undefined,
    status.agentScope.error
      ? `AgentScope：${status.agentScope.error}`
      : undefined,
  ].filter((value): value is string => Boolean(value))
  if (!errors.length) return null
  return (
    <Alert variant='destructive'>
      <AlertTriangle className='size-4' aria-hidden='true' />
      <AlertTitle>部分运行状态检查未通过</AlertTitle>
      <AlertDescription>
        {errors.map((error) => (
          <p key={error}>{error}</p>
        ))}
      </AlertDescription>
    </Alert>
  )
}

export function SetupPage() {
  const actor = useAuthStore((state) => state.auth.user)
  const directory = useWorkspaceDirectory(true)
  const preferredWorkspace = directory.workspaces.find(
    (workspace) => workspace.status === 'active'
  )
  const workspaceId = preferredWorkspace?.workspace_id
  const statusQuery = useQuery({
    queryKey: ['synapse', actor?.user_id ?? 'anonymous', 'setup-status', workspaceId ?? 'none'],
    queryFn: () => probeSetupStatus(workspaceId),
    enabled: Boolean(actor) && !directory.workspaceQuery.isLoading,
  })
  const status = statusQuery.data
  const agentScope = status?.agentScope.data
  const redisState = componentState(agentScope, ['storage', 'message_bus'])
  const qdrantState = componentState(agentScope, ['knowledge_base'])
  const agentScopeState: ProbeState =
    status?.agentScope.state === 'ok'
      ? agentScope?.status === 'ok'
        ? 'ok'
        : 'error'
      : (status?.agentScope.state ?? 'unavailable')

  return (
    <main className='space-y-6 p-6'>
      <header className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <p className='text-sm text-muted-foreground'>Synapse 运行状态</p>
          <h1 className='mt-1 text-2xl font-semibold'>AgentScope 设置</h1>
          <p className='mt-2 max-w-2xl text-sm text-muted-foreground'>
            当前页面检查的是 Synapse 内嵌的 AgentScope 网关和基础设施，不需要配置外部
            AgentScope 地址。
          </p>
        </div>
        <Button
          variant='outline'
          onClick={() => void statusQuery.refetch()}
          disabled={statusQuery.isFetching}
        >
          <RefreshCw
            className={statusQuery.isFetching ? 'size-4 animate-spin' : 'size-4'}
            aria-hidden='true'
          />
          {statusQuery.isFetching ? '检查中…' : '重新检查'}
        </Button>
      </header>

      <section className={panel}>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <h2 className='font-semibold'>连接说明</h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              API 状态来自 HTTP 健康端点。AgentScope 健康报告只检查组件是否已初始化，不会对 Redis 或 Qdrant 执行网络连通性探测。
            </p>
          </div>
          <p className='text-xs text-muted-foreground'>
            最近检查：{formatCheckedAt(status?.checkedAt)}
          </p>
        </div>
        {status?.workspaceId && (
          <p className='mt-3 text-xs text-muted-foreground'>
            AgentScope 探针 Workspace：{status.workspaceId}
          </p>
        )}
      </section>

      {statusQuery.isLoading ? (
        <SetupSkeleton />
      ) : status ? (
        <>
          <section className='grid gap-4 md:grid-cols-2'>
            <RuntimeCard
              title='Synapse API'
              description='当前前端使用的 Synapse API 进程。'
              state={status.synapseApi.state}
              statusLabel={status.synapseApi.state === 'ok' ? '可访问' : undefined}
              icon={Server}
              detail={
                status.synapseApi.data
                  ? `HTTP /health 返回成功：${status.synapseApi.data.service}`
                  : status.synapseApi.error
              }
            />
            <RuntimeCard
              title='AgentScope 运行时'
              description='Synapse 内嵌的 AgentScope API 和后台组件。'
              state={agentScopeState}
              statusLabel={agentScopeState === 'ok' ? '可访问' : undefined}
              icon={Activity}
              detail={
                agentScope?.version
                  ? `AgentScope /health 可访问 · 版本：${agentScope.version}`
                  : status.agentScope.error
              }
            />
            <RuntimeCard
              title='Redis'
              description='AgentScope Storage 和 Message Bus 依赖的 Redis 组件状态。'
              state={redisState}
              statusLabel={redisState === 'ok' ? '组件已就绪' : undefined}
              icon={Wifi}
              detail={
                agentScope
                  ? 'storage 与 message_bus 组件已初始化；当前健康端点不会执行 Redis PING。'
                  : undefined
              }
            />
            <RuntimeCard
              title='Qdrant'
              description='AgentScope 知识库服务及其 Qdrant 向量存储配置状态。'
              state={qdrantState}
              statusLabel={qdrantState === 'ok' ? '服务已就绪' : undefined}
              icon={Database}
              detail={
                agentScope?.components.knowledge_base === 'disabled'
                  ? '当前部署未启用知识库。'
                  : 'knowledge_base 组件已初始化；当前健康端点不会直接访问 Qdrant，无法单独确认向量库连通性。'
              }
            />
          </section>

          <StatusAlert status={status} />

          {agentScope && (
            <section className={`${panel} space-y-4`}>
              <div>
                <h2 className='font-semibold'>AgentScope 能力组件</h2>
                <p className='mt-1 text-sm text-muted-foreground'>
                  这些状态来自 AgentScope `/health` 的组件初始化报告，不代表对每个依赖执行了网络探测；“未启用”表示配置关闭，不等于故障。
                </p>
              </div>
              <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                {Object.entries(agentScope.components).map(([name, componentStatus]) => (
                  <div
                    key={name}
                    className='rounded-lg border bg-muted/20 p-3'
                  >
                    <div className='flex items-center justify-between gap-2'>
                      <p className='font-medium'>
                        {componentLabels[name] ?? name}
                      </p>
                      <Badge
                        variant={
                          componentStatus === 'ok'
                            ? 'default'
                            : componentStatus === 'disabled'
                              ? 'secondary'
                              : 'destructive'
                        }
                      >
                        {componentStatusLabel(componentStatus)}
                      </Badge>
                    </div>
                    {componentDescriptions[name] && (
                      <p className='mt-2 text-xs leading-relaxed text-muted-foreground'>
                        {componentDescriptions[name]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <Alert variant='destructive'>
          <AlertTriangle className='size-4' aria-hidden='true' />
          <AlertTitle>无法读取运行状态</AlertTitle>
          <AlertDescription>
            {statusQuery.error instanceof Error
              ? statusQuery.error.message
              : '请点击“重新检查”重试。'}
          </AlertDescription>
        </Alert>
      )}
    </main>
  )
}
