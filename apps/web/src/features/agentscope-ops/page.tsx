import * as React from 'react'
import { format } from 'date-fns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Calendar,
  CalendarIcon,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  List,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Calendar as DatePicker } from '@/components/ui/calendar'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { FormDialog } from '@/components/form-dialog'
import { useWorkspace } from '@/features/workspaces/context'
import {
  cancelChannelBinding,
  createChannel,
  createSchedule,
  deleteChannel,
  deleteSchedule,
  getChannelStatus,
  listAgents,
  listChannelChatIds,
  listChannelSessions,
  listChannelTypes,
  listChannels,
  listCredentials,
  listModels,
  listScheduleSessions,
  listSchedules,
  pollChannelBinding,
  setChannelEnabled,
  startChannelBinding,
  updateChannel,
  updateSchedule,
} from './api'
import type {
  AgentScopeAgent,
  AgentScopeCredential,
  ChannelBindingView,
  ChannelRecord,
  ChannelTypeSchema,
  ScheduleRecord,
} from './types'

type Tab = 'schedules' | 'channels'
type ScheduleFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom'
type ScheduleDraft = {
  id?: string
  name: string
  description: string
  frequency: ScheduleFrequency
  date: Date
  time: string
  cron_expression: string
  timezone: string
  agent_id: string
  credential_id: string
  model: string
  parameters: string
  enabled: boolean
  stateful: boolean
  permission_mode: string
}
type ChannelDraft = {
  id?: string
  channel_type: string
  name: string
  credentials: string
  credential_binding_id?: string
  platform_config: string
  routing: string
  session: string
  enabled: boolean
}
type ScheduleView = 'calendar' | 'list'
type ChannelCredentialMode = 'manual' | 'binding'

const inputClass = 'h-10 w-full rounded-md border bg-background px-3 text-sm'

function agentName(agent: AgentScopeAgent) {
  return agent.data?.name || agent.name || agent.id
}

function credentialName(credential: AgentScopeCredential) {
  return credential.data?.name || credential.name || credential.id
}

function credentialType(credential: AgentScopeCredential) {
  return credential.data?.type || 'openai'
}

function jsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${label} 必须是有效 JSON。`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`${label} 必须是 JSON 对象。`)
  return parsed as Record<string, unknown>
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请重试。'
}

function formatDate(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString()
}

function parseCronParts(expression: string) {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minute, hour, day, month, weekday] = parts
  return { minute, hour, day, month, weekday }
}

function cronNumber(value: string, min: number, max: number) {
  const aliases = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const normalized = value.toLowerCase()
  if (aliases.includes(normalized)) return aliases.indexOf(normalized)
  if (!/^\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return parsed >= min && parsed <= max ? parsed : null
}

function cronFieldMatches(
  field: string,
  min: number,
  max: number,
  actual: number
) {
  return field.split(',').some((part) => {
    const [rawRange, rawStep] = part.split('/')
    const step = rawStep ? Number.parseInt(rawStep, 10) : 1
    if (!Number.isInteger(step) || step <= 0) return false
    let start = min
    let end: number | null = max
    if (rawRange !== '*') {
      const range = rawRange.split('-')
      if (range.length > 2) return false
      const first = cronNumber(range[0], min, max)
      if (first === null) return false
      start = first
      end =
        range.length === 2
          ? cronNumber(range[1], min, max)
          : rawStep
            ? max
            : first
      if (end === null || end < start) return false
    }
    return actual >= start && actual <= end && (actual - start) % step === 0
  })
}

function buildCronExpression(
  frequency: ScheduleFrequency,
  date: Date,
  time: string,
  fallback: string
) {
  if (frequency === 'custom') return fallback.trim()
  const [hour, minute] = time.split(':').map(Number)
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  )
    return fallback.trim()
  if (frequency === 'once')
    return `${minute} ${hour} ${date.getDate()} ${date.getMonth() + 1} *`
  if (frequency === 'weekly') return `${minute} ${hour} * * ${date.getDay()}`
  if (frequency === 'monthly') return `${minute} ${hour} ${date.getDate()} * *`
  return `${minute} ${hour} * * *`
}

function parseScheduleFrequency(expression: string): {
  frequency: ScheduleFrequency
  time: string
  date?: Date
} {
  const parsed = parseCronParts(expression)
  if (!parsed) return { frequency: 'custom', time: '09:00' }
  const simple = (value: string) => (/^\d+$/.test(value) ? value : null)
  const hour = simple(parsed.hour)
  const minute = simple(parsed.minute)
  const day = simple(parsed.day)
  const month = simple(parsed.month)
  const weekday = simple(parsed.weekday)
  const time =
    hour === null || minute === null
      ? '09:00'
      : `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  const isDaily =
    parsed.day === '*' && parsed.month === '*' && parsed.weekday === '*'
  const isWeekly =
    parsed.day === '*' && parsed.month === '*' && weekday !== null
  const isMonthly =
    day !== null && parsed.month === '*' && parsed.weekday === '*'
  const isOnce = day !== null && month !== null && parsed.weekday === '*'
  let frequency: ScheduleFrequency = 'custom'
  if ((isDaily || isWeekly || isMonthly || isOnce) && hour && minute) {
    if (isDaily) frequency = 'daily'
    else if (isWeekly) frequency = 'weekly'
    else if (isMonthly) frequency = 'monthly'
    else frequency = 'once'
  }
  return { frequency, time }
}

function scheduleMatchesDate(schedule: ScheduleRecord, date: Date) {
  const parsed = parseCronParts(schedule.data.cron_expression)
  if (!parsed) return false
  const startedAt = schedule.data.started_at
    ? new Date(schedule.data.started_at)
    : null
  const endedAt = schedule.data.ended_at
    ? new Date(schedule.data.ended_at)
    : null
  if (startedAt && !Number.isNaN(startedAt.valueOf()) && startedAt > date) {
    // The selected date is over before this schedule was created.
    if (
      startedAt >
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59)
    )
      return false
  }
  if (endedAt && !Number.isNaN(endedAt.valueOf())) {
    if (endedAt < new Date(date.getFullYear(), date.getMonth(), date.getDate()))
      return false
  }
  return (
    cronFieldMatches(parsed.day, 1, 31, date.getDate()) &&
    cronFieldMatches(parsed.month, 1, 12, date.getMonth() + 1) &&
    cronFieldMatches(parsed.weekday, 0, 6, date.getDay())
  )
}

function scheduleTime(schedule: ScheduleRecord) {
  const parsed = parseCronParts(schedule.data.cron_expression)
  if (!parsed) return '自定义'
  return `${parsed.hour.padStart(2, '0')}:${parsed.minute.padStart(2, '0')}`
}

function scheduleHasOccurrenceInRange(
  schedule: ScheduleRecord,
  rangeStart: Date,
  rangeEnd: Date
) {
  if (!parseCronParts(schedule.data.cron_expression)) return true
  const start = new Date(
    rangeStart.getFullYear(),
    rangeStart.getMonth(),
    rangeStart.getDate()
  )
  const end = new Date(
    rangeEnd.getFullYear(),
    rangeEnd.getMonth(),
    rangeEnd.getDate()
  )
  if (
    Number.isNaN(start.valueOf()) ||
    Number.isNaN(end.valueOf()) ||
    start > end
  )
    return true
  for (
    const date = new Date(start);
    date <= end;
    date.setDate(date.getDate() + 1)
  ) {
    if (scheduleMatchesDate(schedule, date)) return true
  }
  return false
}

function monthCells(currentDate: Date) {
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const first = new Date(year, month, 1)
  const days = new Date(year, month + 1, 0).getDate()
  const start = first.getDay()
  return Array.from(
    { length: Math.ceil((start + days) / 7) * 7 },
    (_, index) => {
      const day = index - start + 1
      return new Date(year, month, day)
    }
  )
}

function emptySchedule(
  agents: AgentScopeAgent[],
  credentials: AgentScopeCredential[]
): ScheduleDraft {
  const now = new Date()
  return {
    name: '',
    description: '',
    frequency: 'daily',
    date: now,
    time: `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`,
    cron_expression: `${now.getMinutes()} ${now.getHours()} * * *`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    agent_id: agents[0]?.id ?? '',
    credential_id: credentials[0]?.id ?? '',
    model: '',
    parameters: '{}',
    enabled: true,
    stateful: false,
    permission_mode: 'dont_ask',
  }
}

function scheduleDraft(record: ScheduleRecord): ScheduleDraft {
  const recurrence = parseScheduleFrequency(record.data.cron_expression)
  const startedAt = record.data.started_at
    ? new Date(record.data.started_at)
    : new Date()
  return {
    id: record.id,
    name: record.data.name,
    description: record.data.description,
    frequency: recurrence.frequency,
    date: Number.isNaN(startedAt.valueOf()) ? new Date() : startedAt,
    time: recurrence.time,
    cron_expression: record.data.cron_expression,
    timezone: record.data.timezone,
    agent_id: record.agent_id,
    credential_id: record.data.chat_model_config.credential_id,
    model: record.data.chat_model_config.model,
    parameters: JSON.stringify(
      record.data.chat_model_config.parameters ?? {},
      null,
      2
    ),
    enabled: record.data.enabled,
    stateful: record.data.stateful,
    permission_mode: record.data.permission_mode,
  }
}

function emptyChannel(type?: string): ChannelDraft {
  return {
    channel_type: type ?? '',
    name: '',
    credentials: '{}',
    credential_binding_id: undefined,
    platform_config: '{}',
    routing: JSON.stringify(
      {
        bindings: [
          {
            match_key: 'chat_id',
            match_value: '*',
            agent_id: '',
            session_scope: 'per_chat',
          },
        ],
      },
      null,
      2
    ),
    session: JSON.stringify(
      {
        chat_model_config: {
          type: '',
          credential_id: '',
          model: '',
          parameters: {},
        },
        fallback_chat_model_config: null,
        permission_mode: 'default',
      },
      null,
      2
    ),
    enabled: true,
  }
}

function channelDraft(record: ChannelRecord): ChannelDraft {
  return {
    id: record.id,
    channel_type: record.channel_type,
    name: record.name ?? '',
    credentials: '{}',
    credential_binding_id: undefined,
    platform_config: JSON.stringify(record.platform_config ?? {}, null, 2),
    routing: JSON.stringify(record.routing, null, 2),
    session: JSON.stringify(record.session, null, 2),
    enabled: record.enabled,
  }
}

export function AgentScopeOpsPage({
  initialTab = 'schedules',
}: {
  initialTab?: Tab
}) {
  const { workspace } = useWorkspace()
  const workspaceId = workspace.workspace_id
  const [tab, setTab] = React.useState<Tab>(initialTab)
  const [scheduleEditor, setScheduleEditor] =
    React.useState<ScheduleDraft | null>(null)
  const [channelEditor, setChannelEditor] = React.useState<ChannelDraft | null>(
    null
  )
  const [selectedSchedule, setSelectedSchedule] =
    React.useState<ScheduleRecord | null>(null)
  const [selectedChannel, setSelectedChannel] =
    React.useState<ChannelRecord | null>(null)
  const [scheduleView, setScheduleView] =
    React.useState<ScheduleView>('calendar')
  const [calendarDate, setCalendarDate] = React.useState(new Date())
  const [scheduleDateRange, setScheduleDateRange] = React.useState<
    DateRange | undefined
  >(undefined)

  const queryClient = useQueryClient()
  const schedules = useQuery({
    queryKey: ['agentscope-ops', workspaceId, 'schedules'],
    queryFn: () => listSchedules(workspaceId),
  })
  const channels = useQuery({
    queryKey: ['agentscope-ops', workspaceId, 'channels'],
    queryFn: () => listChannels(workspaceId),
  })
  const agents = useQuery({
    queryKey: ['agentscope-ops', workspaceId, 'agents'],
    queryFn: () => listAgents(workspaceId),
  })
  const credentials = useQuery({
    queryKey: ['agentscope-ops', workspaceId, 'credentials'],
    queryFn: () => listCredentials(workspaceId),
  })
  const channelTypes = useQuery({
    queryKey: ['agentscope-ops', workspaceId, 'channel-types'],
    queryFn: () => listChannelTypes(workspaceId),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: ['agentscope-ops', workspaceId],
    })
  }

  const scheduleSave = useMutation({
    mutationFn: async (draft: ScheduleDraft) => {
      const cronExpression = buildCronExpression(
        draft.frequency,
        draft.date,
        draft.time,
        draft.cron_expression
      )
      if (!cronExpression) throw new Error('请填写有效的频率、日期和时间。')
      if (draft.id) {
        await updateSchedule(workspaceId, draft.id, {
          name: draft.name.trim(),
          description: draft.description,
          cron_expression: cronExpression,
          timezone: draft.timezone.trim(),
          enabled: draft.enabled,
          stateful: draft.stateful,
          permission_mode: draft.permission_mode,
        })
        return
      }
      await createSchedule(workspaceId, {
        name: draft.name.trim(),
        description: draft.description,
        cron_expression: cronExpression,
        timezone: draft.timezone.trim(),
        agent_id: draft.agent_id,
        chat_model_config: {
          type: credentialType(
            credentialItems.find((item) => item.id === draft.credential_id) ??
              ({ id: draft.credential_id } as AgentScopeCredential)
          ),
          credential_id: draft.credential_id,
          model: draft.model.trim(),
          parameters: jsonObject(draft.parameters, '模型参数'),
        },
        enabled: draft.enabled,
        stateful: draft.stateful,
        permission_mode: draft.permission_mode,
      })
    },
    onSuccess: () => {
      setScheduleEditor(null)
      refresh()
    },
  })

  const scheduleDelete = useMutation({
    mutationFn: (scheduleId: string) => deleteSchedule(workspaceId, scheduleId),
    onSuccess: refresh,
  })

  const channelSave = useMutation({
    mutationFn: (draft: ChannelDraft) => {
      const platformConfig = jsonObject(draft.platform_config, '平台配置')
      const routing = jsonObject(
        draft.routing,
        '路由配置'
      ) as ChannelRecord['routing']
      const session = jsonObject(
        draft.session,
        '会话配置'
      ) as ChannelRecord['session']
      if (draft.id) {
        return updateChannel(workspaceId, draft.id, {
          name: draft.name.trim() || null,
          platform_config: platformConfig,
          routing,
          session,
          enabled: draft.enabled,
        })
      }
      if (
        draft.credential_binding_id === undefined &&
        Object.keys(jsonObject(draft.credentials, '凭据')).length === 0
      )
        throw new Error('请完成凭据绑定或填写手动凭据。')
      const credentialPayload = draft.credential_binding_id
        ? { credential_binding_id: draft.credential_binding_id }
        : { credentials: jsonObject(draft.credentials, '凭据') }
      return createChannel(workspaceId, {
        channel_type: draft.channel_type,
        name: draft.name.trim() || null,
        ...credentialPayload,
        platform_config: platformConfig,
        routing,
        session,
        enabled: draft.enabled,
      })
    },
    onSuccess: () => {
      setChannelEditor(null)
      refresh()
    },
  })

  const channelDelete = useMutation({
    mutationFn: (channelId: string) => deleteChannel(workspaceId, channelId),
    onSuccess: () => {
      setSelectedChannel(null)
      refresh()
    },
  })

  const channelToggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setChannelEnabled(workspaceId, id, enabled),
    onSuccess: refresh,
  })

  const agentItems = agents.data?.agents ?? []
  const credentialItems = credentials.data?.credentials ?? []
  const scheduleItems = React.useMemo(
    () => schedules.data?.schedules ?? [],
    [schedules.data?.schedules]
  )
  const channelItems = channels.data ?? []
  const visibleScheduleItems = React.useMemo(() => {
    if (!scheduleDateRange?.from) return scheduleItems
    const rangeEnd = scheduleDateRange.to ?? scheduleDateRange.from
    return scheduleItems.filter((schedule) =>
      scheduleHasOccurrenceInRange(schedule, scheduleDateRange.from!, rangeEnd)
    )
  }, [scheduleDateRange, scheduleItems])
  const pageError =
    schedules.error ||
    channels.error ||
    agents.error ||
    credentials.error ||
    channelTypes.error

  return (
    <main className='space-y-6 p-6'>
      <header className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <p className='text-sm text-muted-foreground'>AgentScope Operations</p>
          <h1 className='mt-1 text-2xl font-semibold'>调度与渠道</h1>
          <p className='mt-1 max-w-3xl text-sm text-muted-foreground'>
            直接管理当前账号在 AgentScope 服务中的 Schedule/AI Tasks 和 Channel
            资源。
          </p>
        </div>
        <Button variant='outline' onClick={refresh}>
          <RefreshCw className='mr-2 size-4' />
          刷新
        </Button>
      </header>

      {pageError && (
        <Alert variant='destructive'>
          <AlertDescription>{errorText(pageError)}</AlertDescription>
        </Alert>
      )}

      <div className='flex gap-2 border-b'>
        <Button
          variant={tab === 'schedules' ? 'default' : 'ghost'}
          onClick={() => setTab('schedules')}
        >
          <CalendarClock className='mr-2 size-4' />
          Schedule / AI Tasks
        </Button>
        <Button
          variant={tab === 'channels' ? 'default' : 'ghost'}
          onClick={() => setTab('channels')}
        >
          <MessageSquare className='mr-2 size-4' />
          Channels
        </Button>
      </div>

      {tab === 'schedules' ? (
        <section className='space-y-4'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
              <h2 className='text-lg font-semibold'>AI Tasks</h2>
              <p className='text-sm text-muted-foreground'>
                AgentScope 的 Schedule API 是 Demo 中的定时 AI Task 入口。
              </p>
            </div>
            <div className='flex flex-wrap gap-2'>
              <div className='flex rounded-md border p-1'>
                <Button
                  size='sm'
                  variant={scheduleView === 'calendar' ? 'secondary' : 'ghost'}
                  onClick={() => setScheduleView('calendar')}
                >
                  <Calendar className='mr-1 size-4' />
                  日历
                </Button>
                <Button
                  size='sm'
                  variant={scheduleView === 'list' ? 'secondary' : 'ghost'}
                  onClick={() => setScheduleView('list')}
                >
                  <List className='mr-1 size-4' />
                  列表
                </Button>
              </div>
              <Button
                onClick={() =>
                  setScheduleEditor(emptySchedule(agentItems, credentialItems))
                }
              >
                <Plus className='mr-2 size-4' />
                新建 Schedule
              </Button>
            </div>
          </div>
          {scheduleView === 'calendar' ? (
            <ScheduleCalendar
              schedules={scheduleItems}
              currentDate={calendarDate}
              onMonthChange={setCalendarDate}
              onSelect={setSelectedSchedule}
            />
          ) : (
            <div className='space-y-3'>
              <ScheduleDateRangeFilter
                value={scheduleDateRange}
                onChange={setScheduleDateRange}
              />
              <div className='grid gap-3 lg:grid-cols-2'>
                {visibleScheduleItems.map((schedule) => (
                  <ScheduleListCard
                    key={schedule.id}
                    schedule={schedule}
                    onSelect={() => setSelectedSchedule(schedule)}
                    onEdit={() => setScheduleEditor(scheduleDraft(schedule))}
                    onDelete={() => {
                      if (
                        window.confirm(
                          `确认删除 Schedule「${schedule.data.name}」？`
                        )
                      )
                        scheduleDelete.mutate(schedule.id)
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          {!visibleScheduleItems.length && !schedules.isLoading && (
            <EmptyState label='当前账号还没有 Schedule。' />
          )}
        </section>
      ) : (
        <ChannelsPanel
          channels={channelItems}
          channelTypes={channelTypes.data ?? []}
          agents={agentItems}
          credentials={credentialItems}
          loading={channels.isLoading}
          onCreate={(type) => setChannelEditor(emptyChannel(type))}
          onEdit={(channel) => setChannelEditor(channelDraft(channel))}
          onSelect={setSelectedChannel}
          onToggle={(channel) =>
            channelToggle.mutate({ id: channel.id, enabled: !channel.enabled })
          }
          onDelete={(channel) => {
            if (
              window.confirm(
                `确认删除 Channel「${channel.name || channel.id}」？`
              )
            )
              channelDelete.mutate(channel.id)
          }}
        />
      )}

      <ScheduleEditor
        draft={scheduleEditor}
        agents={agentItems}
        credentials={credentialItems}
        workspaceId={workspaceId}
        pending={scheduleSave.isPending}
        error={scheduleSave.error}
        onChange={setScheduleEditor}
        onSubmit={() => scheduleEditor && scheduleSave.mutate(scheduleEditor)}
        onCancel={() => setScheduleEditor(null)}
      />
      <ChannelEditor
        draft={channelEditor}
        channelTypes={channelTypes.data ?? []}
        agents={agentItems}
        credentials={credentialItems}
        workspaceId={workspaceId}
        pending={channelSave.isPending}
        error={channelSave.error}
        onChange={setChannelEditor}
        onSubmit={() => channelEditor && channelSave.mutate(channelEditor)}
        onCancel={() => setChannelEditor(null)}
      />
      <ScheduleDetail
        schedule={selectedSchedule}
        workspaceId={workspaceId}
        onClose={() => setSelectedSchedule(null)}
      />
      <ChannelDetail
        channel={selectedChannel}
        workspaceId={workspaceId}
        agents={agentItems}
        onClose={() => setSelectedChannel(null)}
      />
    </main>
  )
}

function ScheduleListCard({
  schedule,
  onSelect,
  onEdit,
  onDelete,
}: {
  schedule: ScheduleRecord
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card
      className='cursor-pointer transition hover:border-primary/50'
      onClick={onSelect}
    >
      <CardHeader className='pb-3'>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <CardTitle className='truncate text-base'>
              {schedule.data.name}
            </CardTitle>
            <CardDescription className='mt-1 truncate'>
              {schedule.data.description || '无描述'}
            </CardDescription>
          </div>
          <span className='rounded-full bg-muted px-2 py-1 text-xs'>
            {schedule.data.enabled ? '启用' : '停用'}
          </span>
        </div>
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        <div className='grid gap-2 text-xs text-muted-foreground sm:grid-cols-2'>
          <Detail label='执行时间' value={scheduleTime(schedule)} />
          <Detail label='Cron' value={schedule.data.cron_expression} />
          <Detail label='时区' value={schedule.data.timezone} />
          <Detail label='Agent' value={schedule.agent_id} />
        </div>
        <div
          className='flex flex-wrap gap-2'
          onClick={(event) => event.stopPropagation()}
        >
          <Button size='sm' variant='outline' onClick={onSelect}>
            详情 / 执行记录 <ChevronRight className='ml-1 size-4' />
          </Button>
          <Button size='sm' variant='outline' onClick={onEdit}>
            编辑
          </Button>
          <Button size='sm' variant='destructive' onClick={onDelete}>
            <Trash2 className='mr-1 size-3.5' /> 删除
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ScheduleCalendar({
  schedules,
  currentDate,
  onMonthChange,
  onSelect,
}: {
  schedules: ScheduleRecord[]
  currentDate: Date
  onMonthChange: (date: Date) => void
  onSelect: (schedule: ScheduleRecord) => void
}) {
  const cells = monthCells(currentDate)
  const month = currentDate.getMonth()
  const year = currentDate.getFullYear()
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return (
    <Card className='overflow-hidden'>
      <CardHeader className='flex flex-row items-center justify-between space-y-0'>
        <CardTitle className='text-base'>
          {currentDate.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
          })}
        </CardTitle>
        <div className='flex items-center gap-1'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => onMonthChange(new Date())}
          >
            今天
          </Button>
          <Button
            size='icon'
            variant='ghost'
            aria-label='上一年'
            onClick={() => onMonthChange(new Date(year - 1, month, 1))}
          >
            <ChevronsLeft className='size-4' />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            aria-label='上个月'
            onClick={() => onMonthChange(new Date(year, month - 1, 1))}
          >
            <ChevronLeft className='size-4' />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            aria-label='下个月'
            onClick={() => onMonthChange(new Date(year, month + 1, 1))}
          >
            <ChevronRight className='size-4' />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            aria-label='下一年'
            onClick={() => onMonthChange(new Date(year + 1, month, 1))}
          >
            <ChevronsRight className='size-4' />
          </Button>
        </div>
      </CardHeader>
      <CardContent className='p-0'>
        <div className='grid grid-cols-7 border-y text-center text-xs text-muted-foreground'>
          {weekdays.map((day) => (
            <div key={day} className='border-r px-2 py-2 last:border-r-0'>
              {day}
            </div>
          ))}
        </div>
        <div className='grid grid-cols-7'>
          {cells.map((date) => {
            const isCurrentMonth = date.getMonth() === month
            const isToday = date.toDateString() === new Date().toDateString()
            const items = schedules.filter(
              (schedule) =>
                schedule.data.enabled && scheduleMatchesDate(schedule, date)
            )
            return (
              <div
                key={date.toISOString()}
                className={`min-h-28 border-r border-b p-2 ${isCurrentMonth ? '' : 'bg-muted/30 text-muted-foreground/50'}`}
              >
                <div
                  className={`mb-1 flex size-6 items-center justify-center text-xs ${isToday ? 'rounded-full bg-primary text-primary-foreground' : ''}`}
                >
                  {date.getDate()}
                </div>
                <div className='space-y-1'>
                  {items.slice(0, 3).map((schedule) => (
                    <button
                      key={schedule.id}
                      className='flex w-full items-center gap-1 truncate rounded bg-primary/10 px-1 py-0.5 text-left text-[11px] hover:bg-primary/20'
                      title={`${scheduleTime(schedule)} ${schedule.data.name}`}
                      onClick={() => onSelect(schedule)}
                    >
                      <span className='size-1.5 shrink-0 rounded-full bg-primary' />
                      <span className='truncate'>{schedule.data.name}</span>
                    </button>
                  ))}
                  {items.length > 3 && (
                    <button
                      className='text-[11px] text-muted-foreground hover:underline'
                      onClick={() => onSelect(items[3])}
                    >
                      +{items.length - 3} 个任务
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function ScheduleDateRangeFilter({
  value,
  onChange,
}: {
  value: DateRange | undefined
  onChange: (value: DateRange | undefined) => void
}) {
  const label = value?.from
    ? value.to
      ? `${format(value.from, 'yyyy-MM-dd')} - ${format(value.to, 'yyyy-MM-dd')}`
      : format(value.from, 'yyyy-MM-dd')
    : '按日期范围筛选'
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant='outline' size='sm' className='justify-start'>
            <CalendarIcon className='mr-2 size-4' />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-auto p-0' align='start'>
          <DatePicker
            mode='range'
            numberOfMonths={2}
            selected={value}
            onSelect={onChange}
            defaultMonth={value?.from}
          />
        </PopoverContent>
      </Popover>
      {value?.from && (
        <Button variant='ghost' size='sm' onClick={() => onChange(undefined)}>
          <X className='mr-1 size-4' />
          清除筛选
        </Button>
      )}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className='py-10 text-center text-sm text-muted-foreground'>
        {label}
      </CardContent>
    </Card>
  )
}

function ChannelsPanel({
  channels,
  channelTypes,
  agents,
  credentials,
  loading,
  onCreate,
  onEdit,
  onSelect,
  onToggle,
  onDelete,
}: {
  channels: ChannelRecord[]
  channelTypes: ChannelTypeSchema[]
  agents: AgentScopeAgent[]
  credentials: AgentScopeCredential[]
  loading: boolean
  onCreate: (type: string) => void
  onEdit: (channel: ChannelRecord) => void
  onSelect: (channel: ChannelRecord) => void
  onToggle: (channel: ChannelRecord) => void
  onDelete: (channel: ChannelRecord) => void
}) {
  return (
    <section className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-lg font-semibold'>Channels</h2>
          <p className='text-sm text-muted-foreground'>
            管理平台渠道、路由规则和渠道会话；凭据不会由服务端返回。
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          {channelTypes.map((type) => (
            <Button
              key={type.channel_type}
              size='sm'
              onClick={() => onCreate(type.channel_type)}
            >
              <Plus className='mr-1 size-3.5' />
              {type.display_name || type.channel_type}
            </Button>
          ))}
        </div>
      </div>
      {loading ? (
        <p className='py-8 text-center text-sm text-muted-foreground'>
          正在加载 Channels…
        </p>
      ) : (
        <div className='grid gap-3 lg:grid-cols-2'>
          {channels.map((channel) => (
            <Card key={channel.id}>
              <CardHeader className='pb-3'>
                <CardTitle className='text-base'>
                  {channel.name || channel.channel_type}
                </CardTitle>
                <CardDescription className='break-all'>
                  {channel.channel_type} ·{' '}
                  {channel.platform_bot_id || '未返回 Bot ID'}
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-3 text-sm'>
                <p className='text-xs break-all text-muted-foreground'>
                  {channel.id}
                </p>
                <div className='flex flex-wrap gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => onSelect(channel)}
                  >
                    详情 / 状态
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => onEdit(channel)}
                  >
                    编辑路由
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => onToggle(channel)}
                  >
                    {channel.enabled ? '停用' : '启用'}
                  </Button>
                  <Button
                    size='sm'
                    variant='destructive'
                    onClick={() => onDelete(channel)}
                  >
                    <Trash2 className='mr-1 size-3.5' />
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {!channels.length && !loading && (
        <EmptyState label='当前账号还没有 Channel。' />
      )}
      <p className='text-xs text-muted-foreground'>
        可用 Agent：{agents.length} · 可用 Credential：{credentials.length}
        。新建 Channel 时请在 JSON 表单中填入服务端要求的凭据和模型配置。
      </p>
    </section>
  )
}

function ScheduleEditor({
  draft,
  agents,
  credentials,
  workspaceId,
  pending,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: ScheduleDraft | null
  agents: AgentScopeAgent[]
  credentials: AgentScopeCredential[]
  workspaceId: string
  pending: boolean
  error: unknown
  onChange: (draft: ScheduleDraft | null) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const set = <K extends keyof ScheduleDraft>(
    key: K,
    value: ScheduleDraft[K]
  ) => onChange(draft ? { ...draft, [key]: value } : draft)
  const selectedCredential = credentials.find(
    (credential) => credential.id === draft?.credential_id
  )
  const models = useQuery({
    queryKey: [
      'agentscope-ops',
      workspaceId,
      'models',
      selectedCredential?.id,
      credentialType(
        selectedCredential ?? ({ id: '' } as AgentScopeCredential)
      ),
    ],
    queryFn: () =>
      listModels(
        workspaceId,
        credentialType(
          selectedCredential ?? ({ id: '' } as AgentScopeCredential)
        )
      ),
    enabled: Boolean(selectedCredential?.id),
  })
  const modelOptions = models.data?.models ?? []

  const setTiming = (
    patch: Partial<Pick<ScheduleDraft, 'frequency' | 'date' | 'time'>>
  ) => {
    if (!draft) return
    const next = { ...draft, ...patch }
    onChange({
      ...next,
      cron_expression: buildCronExpression(
        next.frequency,
        next.date,
        next.time,
        next.cron_expression
      ),
    })
  }

  return (
    <FormDialog
      open={Boolean(draft)}
      onOpenChange={(open) => !open && onCancel()}
      title={draft?.id ? '编辑 Schedule' : '新建 Schedule'}
      description='使用 AgentScope 的真实 schedule API 保存定时 AI Task。'
      error={error ? errorText(error) : undefined}
      pending={pending}
      disabled={
        !draft?.name.trim() ||
        !draft?.agent_id.trim() ||
        !draft?.cron_expression.trim()
      }
      formAriaLabel='Schedule 表单'
      submitLabel={draft?.id ? '保存修改' : '创建 Schedule'}
      onCancel={onCancel}
      onSubmit={onSubmit}
    >
      {draft && (
        <div className='grid gap-4 sm:grid-cols-2'>
          <Field
            label='名称'
            value={draft.name}
            onChange={(value) => set('name', value)}
          />
          <SelectField
            label='频率'
            value={draft.frequency}
            options={[
              { value: 'once', label: '一次' },
              { value: 'daily', label: '每天' },
              { value: 'weekly', label: '每周' },
              { value: 'monthly', label: '每月' },
              { value: 'custom', label: '自定义 Cron' },
            ]}
            onChange={(value) =>
              setTiming({ frequency: value as ScheduleFrequency })
            }
          />
          <div className='space-y-2'>
            <Label>日期</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type='button'
                  variant='outline'
                  className='h-10 w-full justify-start font-normal'
                >
                  <CalendarIcon className='mr-2 size-4' />
                  {format(draft.date, 'yyyy-MM-dd')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-auto p-0' align='start'>
                <DatePicker
                  mode='single'
                  selected={draft.date}
                  onSelect={(date) => date && setTiming({ date })}
                  captionLayout='dropdown'
                />
              </PopoverContent>
            </Popover>
          </div>
          <Field
            label='时间'
            value={draft.time}
            onChange={(value) => setTiming({ time: value })}
          />
          {draft.frequency === 'custom' ? (
            <Field
              label='Cron'
              value={draft.cron_expression}
              onChange={(value) => set('cron_expression', value)}
            />
          ) : (
            <div className='space-y-2'>
              <Label>生成的 Cron</Label>
              <Input value={draft.cron_expression} readOnly />
            </div>
          )}
          <Field
            label='时区'
            value={draft.timezone}
            onChange={(value) => set('timezone', value)}
          />
          {!draft.id && (
            <>
              <SelectField
                label='Agent'
                value={draft.agent_id}
                options={agents.map((agent) => ({
                  value: agent.id,
                  label: agentName(agent),
                }))}
                onChange={(value) => set('agent_id', value)}
              />
              <SelectField
                label='Credential'
                value={draft.credential_id}
                options={credentials.map((credential) => ({
                  value: credential.id,
                  label: credentialName(credential),
                }))}
                onChange={(value) => set('credential_id', value)}
              />
              {modelOptions.length ? (
                <SelectField
                  label={models.isFetching ? '模型（加载中）' : '模型'}
                  value={draft.model}
                  options={modelOptions.map((model) => ({
                    value: model.name,
                    label: model.label || model.name,
                  }))}
                  onChange={(value) => set('model', value)}
                />
              ) : (
                <Field
                  label={models.isFetching ? '模型（加载中）' : '模型名称'}
                  value={draft.model}
                  onChange={(value) => set('model', value)}
                />
              )}
              <JsonField
                label='模型参数 JSON'
                value={draft.parameters}
                onChange={(value) => set('parameters', value)}
              />
            </>
          )}
          <div className='space-y-2 sm:col-span-2'>
            <Label>描述</Label>
            <Textarea
              value={draft.description}
              onChange={(event) => set('description', event.target.value)}
            />
          </div>
          <SelectField
            label='权限模式'
            value={draft.permission_mode}
            options={['default', 'dont_ask', 'ask', 'bypass'].map((value) => ({
              value,
              label: value,
            }))}
            onChange={(value) => set('permission_mode', value)}
          />
          <div className='flex items-center gap-5 pt-7 text-sm'>
            <label className='flex items-center gap-2'>
              <input
                type='checkbox'
                checked={draft.enabled}
                onChange={(event) => set('enabled', event.target.checked)}
              />
              启用
            </label>
            <label className='flex items-center gap-2'>
              <input
                type='checkbox'
                checked={draft.stateful}
                onChange={(event) => set('stateful', event.target.checked)}
              />
              保持上下文
            </label>
          </div>
        </div>
      )}
    </FormDialog>
  )
}

function ChannelEditor({
  draft,
  channelTypes,
  agents,
  credentials,
  workspaceId,
  pending,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: ChannelDraft | null
  channelTypes: ChannelTypeSchema[]
  agents: AgentScopeAgent[]
  credentials: AgentScopeCredential[]
  workspaceId: string
  pending: boolean
  error: unknown
  onChange: (draft: ChannelDraft | null) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const set = <K extends keyof ChannelDraft>(key: K, value: ChannelDraft[K]) =>
    onChange(draft ? { ...draft, [key]: value } : draft)
  const selectedType = channelTypes.find(
    (type) => type.channel_type === draft?.channel_type
  )
  const [credentialMode, setCredentialMode] =
    React.useState<ChannelCredentialMode>('manual')
  const [binding, setBinding] = React.useState<ChannelBindingView | null>(null)
  const [bindingError, setBindingError] = React.useState('')
  const bindingRef = React.useRef<ChannelBindingView | null>(null)
  const draftRef = React.useRef<ChannelDraft | null>(draft)
  const wasOpenRef = React.useRef(false)
  const previousChannelTypeRef = React.useRef<string | undefined>(undefined)
  const isDraftOpen = Boolean(draft)
  const draftId = draft?.id
  const draftChannelType = draft?.channel_type

  React.useEffect(() => {
    draftRef.current = draft
  }, [draft])

  React.useEffect(() => {
    bindingRef.current = binding
  }, [binding])

  React.useEffect(() => {
    if (!isDraftOpen) {
      wasOpenRef.current = false
      previousChannelTypeRef.current = undefined
      return
    }
    const channelTypeChanged =
      previousChannelTypeRef.current !== draftChannelType
    if (!draftId && (!wasOpenRef.current || channelTypeChanged)) {
      setCredentialMode('manual')
      setBinding(null)
      bindingRef.current = null
      setBindingError('')
    }
    wasOpenRef.current = true
    previousChannelTypeRef.current = draftChannelType
  }, [draftChannelType, draftId, isDraftOpen])

  React.useEffect(() => {
    if (!binding || binding.state !== 'pending' || !isDraftOpen) return
    const timer = window.setTimeout(
      () => {
        void pollChannelBinding(workspaceId, binding.binding_id)
          .then((result) => {
            setBinding(result)
            if (result.state === 'authorized' && draftRef.current) {
              onChange({
                ...draftRef.current,
                credential_binding_id: result.binding_id,
              })
            }
          })
          .catch((error: unknown) => {
            setBindingError(errorText(error))
            setBinding((current) =>
              current
                ? { ...current, state: 'failed', error: errorText(error) }
                : current
            )
          })
      },
      Math.max((binding.retry_after_secs ?? 2) * 1000, 1000)
    )
    return () => window.clearTimeout(timer)
  }, [binding, isDraftOpen, onChange, workspaceId])

  const cancelPendingBinding = async () => {
    const active = bindingRef.current
    if (active?.state === 'pending') {
      await cancelChannelBinding(workspaceId, active.binding_id).catch(() => {})
    }
    bindingRef.current = null
    setBinding(null)
    if (draft && !draft.id) set('credential_binding_id', undefined)
  }

  const beginBinding = async () => {
    if (!draft?.channel_type) return
    setBindingError('')
    try {
      const result = await startChannelBinding(workspaceId, draft.channel_type)
      setBinding(result)
      bindingRef.current = result
      if (result.state === 'authorized')
        set('credential_binding_id', result.binding_id)
    } catch (error) {
      setBindingError(errorText(error))
    }
  }

  const routing = draft
    ? parseJsonOr(draft.routing, { bindings: [] })
    : { bindings: [] }
  const bindings = Array.isArray(routing.bindings)
    ? (routing.bindings as Array<Record<string, unknown>>)
    : []
  const session = parseJsonOr(draft?.session ?? '{}', {
    chat_model_config: {
      type: '',
      credential_id: '',
      model: '',
      parameters: {},
    },
    fallback_chat_model_config: null,
    permission_mode: 'default',
  })
  const chatModelConfig =
    session.chat_model_config &&
    typeof session.chat_model_config === 'object' &&
    !Array.isArray(session.chat_model_config)
      ? (session.chat_model_config as Record<string, unknown>)
      : {}
  const updateRouting = (next: Record<string, unknown>) =>
    set('routing', JSON.stringify(next, null, 2))
  const updateSession = (next: Record<string, unknown>) =>
    set('session', JSON.stringify(next, null, 2))
  const credentialSchema = asSchema(selectedType?.credentials_schema)
  const configSchema = asSchema(selectedType?.config_schema)
  const selectedCredential = credentials.find(
    (credential) =>
      credential.id === String(chatModelConfig.credential_id ?? '')
  )
  const models = useQuery({
    queryKey: [
      'agentscope-ops',
      workspaceId,
      'models',
      selectedCredential?.id,
      credentialType(
        selectedCredential ?? ({ id: '' } as AgentScopeCredential)
      ),
    ],
    queryFn: () =>
      listModels(
        workspaceId,
        credentialType(
          selectedCredential ?? ({ id: '' } as AgentScopeCredential)
        )
      ),
    enabled: Boolean(selectedCredential?.id),
  })
  const modelOptions = models.data?.models ?? []
  const handleCancel = () => {
    void cancelPendingBinding().finally(onCancel)
  }
  const handleCredentialMode = (mode: ChannelCredentialMode) => {
    void cancelPendingBinding()
    setCredentialMode(mode)
  }
  const handleChannelType = (value: string) => {
    void cancelPendingBinding()
    set('channel_type', value)
  }
  return (
    <FormDialog
      open={Boolean(draft)}
      onOpenChange={(open) => !open && handleCancel()}
      title={draft?.id ? '编辑 Channel' : '新建 Channel'}
      description='凭据、平台配置、路由和会话设置直接提交到 AgentScope。'
      error={error ? errorText(error) : undefined}
      pending={pending}
      disabled={
        !draft?.channel_type ||
        (!draft.id &&
          credentialMode === 'binding' &&
          binding?.state !== 'authorized')
      }
      formAriaLabel='Channel 表单'
      submitLabel={draft?.id ? '保存修改' : '创建 Channel'}
      onCancel={handleCancel}
      onSubmit={onSubmit}
    >
      {draft && (
        <div className='space-y-4'>
          {!draft.id && (
            <SelectField
              label='渠道类型'
              value={draft.channel_type}
              options={channelTypes.map((type) => ({
                value: type.channel_type,
                label: type.display_name || type.channel_type,
              }))}
              onChange={handleChannelType}
            />
          )}
          <Field
            label='名称'
            value={draft.name}
            onChange={(value) => set('name', value)}
          />
          <p className='text-xs text-muted-foreground'>
            {selectedType
              ? `服务端 schema：${selectedType.channel_type}`
              : '先选择渠道类型。'}
          </p>
          {!draft.id && selectedType?.supports_credential_binding && (
            <div className='space-y-3 rounded-md border p-3'>
              <div className='flex gap-2'>
                <Button
                  type='button'
                  size='sm'
                  variant={
                    credentialMode === 'manual' ? 'secondary' : 'outline'
                  }
                  onClick={() => handleCredentialMode('manual')}
                >
                  手动凭据
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant={
                    credentialMode === 'binding' ? 'secondary' : 'outline'
                  }
                  onClick={() => handleCredentialMode('binding')}
                >
                  绑定凭据
                </Button>
              </div>
              {credentialMode === 'binding' ? (
                <div className='space-y-2'>
                  <p className='text-xs text-muted-foreground'>
                    使用 AgentScope 真实绑定流程，凭据不会直接经过表单提交。
                  </p>
                  {!binding || binding.state === 'failed' ? (
                    <Button
                      type='button'
                      size='sm'
                      onClick={() => void beginBinding()}
                    >
                      开始绑定
                    </Button>
                  ) : (
                    <div className='space-y-2 text-sm'>
                      <p>绑定状态：{binding.state}</p>
                      {binding.verification_url && (
                        <a
                          className='break-all text-primary underline'
                          href={binding.verification_url}
                          target='_blank'
                          rel='noreferrer'
                        >
                          打开验证地址
                        </a>
                      )}
                      {binding.state === 'authorized' && (
                        <p className='text-emerald-600'>
                          已授权，可以创建 Channel。
                        </p>
                      )}
                    </div>
                  )}
                  {bindingError && (
                    <p className='text-sm text-destructive'>{bindingError}</p>
                  )}
                </div>
              ) : (
                <SchemaObjectFields
                  schema={credentialSchema}
                  value={parseJsonOr(draft.credentials, {})}
                  secret
                  onChange={(value) =>
                    set('credentials', JSON.stringify(value, null, 2))
                  }
                />
              )}
            </div>
          )}
          <SchemaObjectFields
            schema={configSchema}
            value={parseJsonOr(draft.platform_config, {})}
            onChange={(value) =>
              set('platform_config', JSON.stringify(value, null, 2))
            }
            title='平台配置'
          />
          <div className='space-y-3 rounded-md border p-3 sm:col-span-2'>
            <div className='flex items-center justify-between'>
              <div>
                <Label>路由绑定</Label>
                <p className='text-xs text-muted-foreground'>
                  按顺序匹配 chat ID，将消息分配给 Agent。
                </p>
              </div>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() =>
                  updateRouting({
                    bindings: [
                      ...bindings.slice(0, -1),
                      {
                        match_key: 'chat_id',
                        match_value: '',
                        agent_id: agents[0]?.id ?? '',
                        session_scope: 'per_chat',
                      },
                      ...(bindings.length
                        ? [bindings[bindings.length - 1]]
                        : []),
                    ],
                  })
                }
              >
                <Plus className='mr-1 size-3.5' /> 添加规则
              </Button>
            </div>
            {bindings.map((item, index) => {
              const isFallback = index === bindings.length - 1
              return (
                <div
                  key={index}
                  className='grid gap-2 rounded-md bg-muted/40 p-3 sm:grid-cols-4'
                >
                  <Input
                    value={String(item.match_key ?? 'chat_id')}
                    disabled={isFallback}
                    onChange={(event) => {
                      const next = [...bindings]
                      next[index] = { ...item, match_key: event.target.value }
                      updateRouting({ bindings: next })
                    }}
                    placeholder='匹配字段'
                  />
                  <Input
                    value={String(item.match_value ?? '')}
                    disabled={isFallback}
                    onChange={(event) => {
                      const next = [...bindings]
                      next[index] = { ...item, match_value: event.target.value }
                      updateRouting({ bindings: next })
                    }}
                    placeholder={isFallback ? '*' : 'chat_id'}
                  />
                  <SelectField
                    label='Agent'
                    value={String(item.agent_id ?? '')}
                    options={agents.map((agent) => ({
                      value: agent.id,
                      label: agentName(agent),
                    }))}
                    onChange={(value) => {
                      const next = [...bindings]
                      next[index] = { ...item, agent_id: value }
                      updateRouting({ bindings: next })
                    }}
                  />
                  <div className='flex items-end gap-2'>
                    <SelectField
                      label='会话范围'
                      value={String(item.session_scope ?? 'per_chat')}
                      options={[
                        { value: 'per_chat', label: '每个聊天' },
                        { value: 'per_chat_user', label: '聊天 + 用户' },
                      ]}
                      onChange={(value) => {
                        const next = [...bindings]
                        next[index] = { ...item, session_scope: value }
                        updateRouting({ bindings: next })
                      }}
                    />
                    {!isFallback && (
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        className='text-destructive'
                        onClick={() =>
                          updateRouting({
                            bindings: bindings.filter((_, i) => i !== index),
                          })
                        }
                      >
                        <Trash2 className='size-4' />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className='space-y-3 rounded-md border p-3 sm:col-span-2'>
            <Label>会话模型</Label>
            <div className='grid gap-3 sm:grid-cols-2'>
              <SelectField
                label='Credential'
                value={String(chatModelConfig.credential_id ?? '')}
                options={credentials.map((credential) => ({
                  value: credential.id,
                  label: credentialName(credential),
                }))}
                onChange={(value) =>
                  updateSession({
                    ...session,
                    chat_model_config: {
                      ...chatModelConfig,
                      credential_id: value,
                      type: credentialType(
                        credentials.find(
                          (credential) => credential.id === value
                        ) ?? ({ id: value } as AgentScopeCredential)
                      ),
                    },
                  })
                }
              />
              {modelOptions.length ? (
                <SelectField
                  label={models.isFetching ? '模型（加载中）' : '模型'}
                  value={String(chatModelConfig.model ?? '')}
                  options={modelOptions.map((model) => ({
                    value: model.name,
                    label: model.label || model.name,
                  }))}
                  onChange={(value) =>
                    updateSession({
                      ...session,
                      chat_model_config: {
                        ...chatModelConfig,
                        model: value,
                      },
                    })
                  }
                />
              ) : (
                <Field
                  label={models.isFetching ? '模型（加载中）' : '模型'}
                  value={String(chatModelConfig.model ?? '')}
                  onChange={(value) =>
                    updateSession({
                      ...session,
                      chat_model_config: {
                        ...chatModelConfig,
                        model: value,
                      },
                    })
                  }
                />
              )}
            </div>
            <JsonField
              label='会话配置 JSON（高级）'
              value={draft.session}
              onChange={(value) => set('session', value)}
            />
          </div>
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={draft.enabled}
              onChange={(event) => set('enabled', event.target.checked)}
            />
            创建后启用
          </label>
        </div>
      )}
    </FormDialog>
  )
}

function parseJsonOr(value: string, fallback: Record<string, unknown>) {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : fallback
  } catch {
    return fallback
  }
}

function asSchema(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { properties: {}, required: [] as string[] }
  }
  const schema = value as {
    properties?: Record<string, Record<string, unknown>>
    required?: string[]
  }
  return {
    properties: schema.properties ?? {},
    required: schema.required ?? [],
  }
}

function SchemaObjectFields({
  schema,
  value,
  onChange,
  title,
  secret = false,
}: {
  schema: {
    properties: Record<string, Record<string, unknown>>
    required: string[]
  }
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  title?: string
  secret?: boolean
}) {
  const fields = Object.entries(schema.properties)
  if (!fields.length) {
    return title ? (
      <p className='text-xs text-muted-foreground'>{title}暂无可配置字段。</p>
    ) : null
  }
  return (
    <div className='space-y-3 sm:col-span-2'>
      {title && <Label>{title}</Label>}
      <div className='grid gap-3 sm:grid-cols-2'>
        {fields.map(([key, definition]) => {
          const type = String(definition.type ?? 'string')
          const current = value[key]
          const label = String(definition.title ?? key)
          const required = schema.required.includes(key)
          return (
            <div key={key} className='space-y-1'>
              <Label>
                {label}
                {required ? ' *' : ''}
              </Label>
              {type === 'boolean' ? (
                <label className='flex h-10 items-center gap-2 rounded-md border px-3 text-sm'>
                  <input
                    type='checkbox'
                    checked={Boolean(current ?? definition.default ?? false)}
                    onChange={(event) =>
                      onChange({ ...value, [key]: event.target.checked })
                    }
                  />
                  {(current ?? definition.default ?? false) === true
                    ? '启用'
                    : '关闭'}
                </label>
              ) : (
                <Input
                  type={
                    secret || definition.format === 'password'
                      ? 'password'
                      : 'text'
                  }
                  value={String(current ?? definition.default ?? '')}
                  placeholder={String(definition.description ?? '')}
                  onChange={(event) =>
                    onChange({ ...value, [key]: event.target.value })
                  }
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ScheduleDetail({
  schedule,
  workspaceId,
  onClose,
}: {
  schedule: ScheduleRecord | null
  workspaceId: string
  onClose: () => void
}) {
  const sessions = useQuery({
    queryKey: [
      'agentscope-ops',
      workspaceId,
      'schedule-sessions',
      schedule?.id,
    ],
    queryFn: () => listScheduleSessions(workspaceId, schedule!.id),
    enabled: Boolean(schedule),
  })
  return (
    <Dialog
      open={Boolean(schedule)}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{schedule?.data.name}</DialogTitle>
          <DialogDescription>Schedule 详情与执行会话</DialogDescription>
        </DialogHeader>
        {schedule && (
          <div className='space-y-4 text-sm'>
            <dl className='grid gap-2 sm:grid-cols-2'>
              <Detail label='ID' value={schedule.id} />
              <Detail label='Agent' value={schedule.agent_id} />
              <Detail label='Cron' value={schedule.data.cron_expression} />
              <Detail label='时区' value={schedule.data.timezone} />
              <Detail
                label='创建时间'
                value={formatDate(schedule.created_at)}
              />
              <Detail
                label='更新时间'
                value={formatDate(schedule.updated_at)}
              />
            </dl>
            <div>
              <h3 className='mb-2 font-medium'>执行会话</h3>
              {sessions.isLoading ? (
                <p className='text-muted-foreground'>正在加载…</p>
              ) : sessions.error ? (
                <p className='text-destructive'>{errorText(sessions.error)}</p>
              ) : sessions.data?.sessions.length ? (
                <div className='space-y-2'>
                  {sessions.data.sessions.map((session) => (
                    <div key={session.id} className='rounded-md border p-3'>
                      <p className='font-mono text-xs break-all'>
                        {session.id}
                      </p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        {session.config?.name || '未命名会话'} ·{' '}
                        {formatDate(session.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className='text-muted-foreground'>暂无执行会话。</p>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChannelDetail({
  channel,
  workspaceId,
  agents,
  onClose,
}: {
  channel: ChannelRecord | null
  workspaceId: string
  agents: AgentScopeAgent[]
  onClose: () => void
}) {
  const status = useQuery({
    queryKey: ['agentscope-ops', workspaceId, 'channel-status', channel?.id],
    queryFn: () => getChannelStatus(workspaceId, channel!.id),
    enabled: Boolean(channel),
  })
  const sessions = useQuery({
    queryKey: ['agentscope-ops', workspaceId, 'channel-sessions', channel?.id],
    queryFn: () => listChannelSessions(workspaceId, channel!.id),
    enabled: Boolean(channel),
  })
  const chats = useQuery({
    queryKey: ['agentscope-ops', workspaceId, 'channel-chats', channel?.id],
    queryFn: () => listChannelChatIds(workspaceId, channel!.id),
    enabled: Boolean(channel),
  })
  return (
    <Dialog open={Boolean(channel)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{channel?.name || channel?.channel_type}</DialogTitle>
          <DialogDescription>
            Channel 状态、已知聊天和关联会话
          </DialogDescription>
        </DialogHeader>
        {channel && (
          <div className='space-y-4 text-sm'>
            <dl className='grid gap-2 sm:grid-cols-2'>
              <Detail label='ID' value={channel.id} />
              <Detail label='类型' value={channel.channel_type} />
              <Detail label='启用' value={channel.enabled ? '是' : '否'} />
              <Detail
                label='运行状态'
                value={
                  status.isLoading ? '加载中…' : (status.data?.state ?? '未知')
                }
              />
            </dl>
            {status.data?.last_error && (
              <Alert variant='destructive'>
                <AlertDescription>{status.data.last_error}</AlertDescription>
              </Alert>
            )}
            <div>
              <h3 className='mb-2 font-medium'>Bindings</h3>
              <div className='overflow-x-auto rounded-md border'>
                <table className='w-full text-left text-xs'>
                  <thead className='bg-muted text-muted-foreground'>
                    <tr>
                      <th className='px-3 py-2'>匹配</th>
                      <th className='px-3 py-2'>Agent</th>
                      <th className='px-3 py-2'>会话范围</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channel.routing.bindings.map((binding, index) => (
                      <tr
                        key={`${binding.match_key}-${index}`}
                        className='border-t'
                      >
                        <td className='px-3 py-2 font-mono'>
                          {index === channel.routing.bindings.length - 1
                            ? '默认规则 (*)'
                            : `${binding.match_key} = ${binding.match_value}`}
                        </td>
                        <td className='px-3 py-2'>
                          {agentName(
                            agents.find(
                              (agent) => agent.id === binding.agent_id
                            ) ?? ({ id: binding.agent_id } as AgentScopeAgent)
                          )}
                        </td>
                        <td className='px-3 py-2'>{binding.session_scope}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 className='mb-2 font-medium'>已知聊天</h3>
              {chats.data?.chats.length ? (
                <div className='grid gap-2 sm:grid-cols-2'>
                  {chats.data.chats.map((chat) => (
                    <div
                      key={chat.chat_id}
                      className='rounded-md border px-3 py-2 text-xs'
                    >
                      <p className='font-medium'>{chat.name || '未命名聊天'}</p>
                      <p className='mt-1 font-mono break-all text-muted-foreground'>
                        {chat.chat_id}
                      </p>
                      <p className='mt-1 text-muted-foreground'>
                        来源：{chat.source}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className='text-muted-foreground'>暂无已知聊天。</p>
              )}
            </div>
            <div>
              <h3 className='mb-2 font-medium'>关联会话</h3>
              {sessions.data?.sessions.length ? (
                <div className='space-y-2'>
                  {sessions.data.sessions.map((session) => (
                    <div key={session.id} className='rounded-md border p-3'>
                      <p className='font-mono text-xs break-all'>
                        {session.id}
                      </p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        {session.config?.name || '未命名会话'} ·{' '}
                        {formatDate(session.created_at)}
                      </p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        状态：{session.origin?.type || 'channel'}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className='text-muted-foreground'>暂无关联会话。</p>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className='space-y-2'>
      <Label>{label}</Label>
      <Input
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function JsonField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className='space-y-2 sm:col-span-2'>
      <Label>{label}</Label>
      <Textarea
        className='min-h-28 font-mono text-xs'
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className='space-y-2'>
      <Label>{label}</Label>
      <select
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value=''>请选择</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className='text-xs text-muted-foreground'>{label}</dt>
      <dd className='break-all'>{value}</dd>
    </div>
  )
}
