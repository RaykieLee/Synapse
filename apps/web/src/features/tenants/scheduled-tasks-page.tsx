import { useState } from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { Input } from '@/components/ui/input'
import { getLocale, useLocale } from '@/lib/i18n'
import { useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getTenant } from '@/api/tenants'
import {
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTaskRun,
  listScheduledTaskRuns,
  listScheduledTaskTargets,
  listScheduledTasks,
  triggerScheduledTask,
  updateScheduledTask,
  type Target,
  type Task,
  type TaskRun,
} from '@/api/scheduled-tasks'
import { ApiProblem } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { LocalizedText } from '@/components/localized-text'
import { FormDialog } from '@/components/form-dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type TaskDraft = {
  task_id?: string; task_name: string; description: string; execution_target: string; schedule_type: 'cron' | 'interval'
  cron_expression: string; interval_value: string; interval_unit: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks'
  timezone: string; enabled: boolean; parameters: Record<string, string | number | boolean | null>
}

const panel = 'rounded-lg border bg-card p-5 shadow-sm'
const input = 'h-10 w-full rounded-md border bg-background px-3 text-sm'
const button = 'rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50'
const primary = 'rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50'
const intervalUnits: TaskDraft['interval_unit'][] = ['seconds', 'minutes', 'hours', 'days', 'weeks']
const unitLabels: Record<TaskDraft['interval_unit'], string> = { seconds: '秒', minutes: '分钟', hours: '小时', days: '天', weeks: '周' }

export function TenantScheduledTasksPage() {
  const actorId = useAuthStore((state) => state.auth.user?.user_id ?? 'anonymous')
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId/scheduled-tasks' })
  // key 重置本地任务草稿与运行上下文，避免跨租户串态。
  return <TenantScheduledTasksPanel key={`${actorId}:${tenantId}`} tenantId={tenantId} actorId={actorId} />
}

function TenantScheduledTasksPanel({ tenantId, actorId }: { tenantId: string; actorId: string }) {
  const client = useQueryClient()
  const isEnglish = useLocale() === 'en'
  const [draft, setDraft] = useState<TaskDraft | null>(null)
  const [historyTask, setHistoryTask] = useState<Task | null>(null)
  const [runConfirmation, setRunConfirmation] = useState<Task | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)
  const [manualRun, setManualRun] = useState<{ tenantId: string; task: Task; run: TaskRun } | null>(null)
  const [manualRunError, setManualRunError] = useState('')
  const [manualRunPendingId, setManualRunPendingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [targetFilter, setTargetFilter] = useState('')
  const [scheduleFilter, setScheduleFilter] = useState('')
  const [enabledFilter, setEnabledFilter] = useState('')
  const [page, setPage] = useState(1)
  const tenantKey = ['synapse', actorId, tenantId, 'personal', 'tenant'] as const
  const tenant = useQuery({ queryKey: tenantKey, queryFn: () => getTenant(tenantId) })
  const canManage = tenant.data?.tenant_role === 'owner' || tenant.data?.tenant_role === 'admin'
  const active = tenant.data?.status === 'active'
  const params = new URLSearchParams({ page: String(page), page_size: '20' })
  if (search.trim()) params.set('task_name', search.trim())
  if (targetFilter) params.set('execution_target', targetFilter)
  if (scheduleFilter) params.set('schedule_type', scheduleFilter)
  if (enabledFilter) params.set('enabled', enabledFilter)
  const listKey = ['synapse', actorId, tenantId, 'tenant', 'scheduled-tasks', 'list', page, params.toString()] as const
  const tasks = useQuery({
    queryKey: listKey,
    enabled: canManage && active,
    queryFn: () => listScheduledTasks(tenantId, {
      page: Number(params.get('page') ?? '1'),
      taskName: params.get('task_name') ?? undefined,
      executionTarget: params.get('execution_target') ?? undefined,
      scheduleType: params.get('schedule_type') as 'cron' | 'interval' | null ?? undefined,
      enabled: params.has('enabled') ? params.get('enabled') === 'true' : undefined,
    }),
  })
  const targetKey = ['synapse', actorId, tenantId, 'tenant', 'scheduled-tasks', 'targets'] as const
  const targets = useQuery({
    queryKey: targetKey,
    enabled: canManage && active,
    queryFn: () => listScheduledTaskTargets(tenantId),
  })
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['synapse', actorId, tenantId, 'tenant', 'scheduled-tasks'] })
  }
  const save = useMutation({
    mutationFn: (value: TaskDraft) => {
      const body = {
        task_name: value.task_name.trim(),
        description: value.description.trim() || null,
        execution_target: value.execution_target,
        parameters: value.parameters,
        schedule_type: value.schedule_type,
        cron_expression: value.schedule_type === 'cron' ? value.cron_expression.trim() : null,
        interval_value: value.schedule_type === 'interval' ? Number(value.interval_value) : null,
        interval_unit: value.schedule_type === 'interval' ? value.interval_unit : null,
        timezone: value.timezone.trim(),
        ...(value.task_id ? {} : { enabled: value.enabled }),
      }
      return value.task_id
        ? updateScheduledTask(tenantId, value.task_id, body)
        : createScheduledTask(tenantId, body)
    },
    onSuccess: async () => { setDraft(null); setError(''); await invalidate() },
    onError: (cause) => setError(errorText(cause)),
  })
  const toggle = useMutation({
    mutationFn: (task: Task) => updateScheduledTask(tenantId, task.task_id, { enabled: !task.enabled }),
    onSuccess: async () => { setError(''); await invalidate() },
    onError: (cause) => setError(errorText(cause)),
  })
  const remove = useMutation({
    mutationFn: (taskId: string) => deleteScheduledTask(tenantId, taskId),
    onSuccess: async () => { setDeleteTarget(null); setError(''); await invalidate() },
    onError: (cause) => { setDeleteTarget(null); setError(errorText(cause)) },
  })
  const confirmManualRun = async () => {
    if (!runConfirmation || manualRunPendingId) return
    const task = runConfirmation
    const requestTenantId = tenantId
    setManualRunPendingId(task.task_id); setManualRunError(''); setManualRun(null); setRunConfirmation(null)
    try {
      const run = await triggerScheduledTask(requestTenantId, task.task_id)
      setManualRun({ tenantId: requestTenantId, task, run })
      setHistoryTask(task)
      setManualRunPendingId(null)
      await client.invalidateQueries({ queryKey: ['synapse', actorId, requestTenantId, 'tenant', 'scheduled-tasks'] })
    } catch (cause) {
      setManualRunError(manualRunErrorText(cause))
      setManualRunPendingId(null)
      if (cause instanceof ApiProblem && cause.status === 409 && cause.code === 'TASK_UNAVAILABLE') {
        await client.invalidateQueries({ queryKey: listKey })
      }
    }
  }

  if (tenant.isLoading) return <main className="p-6"><LocalizedText text={"正在加载租户…"} /></main>
  if (tenant.isError) return <main className="space-y-4 p-6"><ErrorBox message={errorText(tenant.error)} /></main>
  if (!canManage) return <main className="space-y-4 p-6"><ErrorBox message="仅租户所有者或管理员可以管理系统任务定义。" /></main>

  const pending = save.isPending || toggle.isPending || remove.isPending
  return <main className="space-y-5 p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold"><LocalizedText text={"系统任务定义"} /></h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground"><LocalizedText text={"配置当前租户的 cron 或间隔任务。执行目标来自平台 allowlist；编辑计划会由服务端校验完整定义。"} /></p></div>
      <button className={primary} disabled={!active || targets.isError} onClick={() => { setError(''); setDraft(emptyDraft(targets.data?.items[0]?.target_id ?? '')) }}><LocalizedText text={"创建任务"} /></button>
    </header>
    {!active && <ErrorBox message="租户未启用，任务定义只读。" />}
    {error && <ErrorBox message={error} />}
    {targets.isError && <ErrorBox message={`读取允许的执行目标失败：${errorText(targets.error)}`} />}
    {draft && <TaskEditor draft={draft} targets={targets.data?.items ?? []} pending={save.isPending} error={error} onChange={setDraft} onCancel={() => setDraft(null)} onSave={() => save.mutate(draft)} />}
    <section className={`${panel} space-y-4`}>
      <div className="flex flex-wrap gap-3">
        <Input aria-label="按任务名称筛选" className={`${input} max-w-sm`} value={search} placeholder="按任务名称筛选" onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
        <LocalizedNativeSelect aria-label="按执行目标筛选" className={`${input} max-w-64`} value={targetFilter} onChange={(event) => { setTargetFilter(event.target.value); setPage(1) }}><option value=""><LocalizedText text={"全部目标"} /></option>{(targets.data?.items ?? []).map((target) => <option key={target.target_id} value={target.target_id}>{target.name}</option>)}</LocalizedNativeSelect>
        <LocalizedNativeSelect aria-label="按计划类型筛选" className={`${input} max-w-40`} value={scheduleFilter} onChange={(event) => { setScheduleFilter(event.target.value); setPage(1) }}><option value=""><LocalizedText text={"全部计划"} /></option><option value="cron"><LocalizedText text={"Cron"} /></option><option value="interval"><LocalizedText text={"间隔"} /></option></LocalizedNativeSelect>
        <LocalizedNativeSelect aria-label="按启用状态筛选" className={`${input} max-w-40`} value={enabledFilter} onChange={(event) => { setEnabledFilter(event.target.value); setPage(1) }}><option value=""><LocalizedText text={"全部状态"} /></option><option value="true"><LocalizedText text={"启用"} /></option><option value="false"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect>
      </div>
      {tasks.isLoading ? <p className="py-6 text-center text-sm text-muted-foreground"><LocalizedText text={"正在加载任务…"} /></p> : tasks.isError ? <ErrorBox message={errorText(tasks.error)} /> : tasks.data?.items.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3"><LocalizedText text={"任务"} /></th><th className="p-3"><LocalizedText text={"执行目标"} /></th><th className="p-3"><LocalizedText text={"计划"} /></th><th className="p-3"><LocalizedText text={"时区"} /></th><th className="p-3"><LocalizedText text={"状态"} /></th><th className="p-3"><LocalizedText text={"操作"} /></th></tr></thead><tbody>{tasks.data.items.map((task) => {
        const target = targets.data?.items.find((item) => item.target_id === task.execution_target)
        return <tr className="border-b align-top last:border-0" key={`${task.tenant_id}:${task.task_id}`}>
          <td className="p-3"><span className="font-medium">{task.task_name}</span>{task.description && <span className="mt-1 block max-w-sm text-xs text-muted-foreground">{task.description}</span>}</td>
          <td className="p-3"><code>{task.execution_target}</code>{target && <span className="mt-1 block text-xs text-muted-foreground">{target.name}</span>}</td>
          <td className="p-3">{task.schedule_type === 'cron' ? <><span className="font-mono">{task.cron_expression}</span><span className="block text-xs text-muted-foreground"><LocalizedText text={"Cron"} /></span></> : <>{task.interval_value} {unitLabels[task.interval_unit ?? 'minutes']}<span className="block text-xs text-muted-foreground"><LocalizedText text={"间隔"} /></span></>}</td>
          <td className="p-3">{task.timezone}</td><td className="p-3">{task.enabled ? <LocalizedText text={"启用"} /> : <LocalizedText text={"停用"} />}</td>
          <td className="space-x-3 whitespace-nowrap p-3"><button className="underline" onClick={() => setHistoryTask(task)}><LocalizedText text={"执行记录"} /></button><button className="underline" disabled={!active || !task.enabled || pending || Boolean(manualRunPendingId)} onClick={() => { setManualRunError(''); setRunConfirmation(task) }}><LocalizedText text={"立即运行"} /></button><button className="underline" disabled={!active || pending || manualRunPendingId === task.task_id} onClick={() => { setError(''); setDraft(toDraft(task)) }}><LocalizedText text={"编辑"} /></button><button className="underline" disabled={!active || pending || manualRunPendingId === task.task_id} onClick={() => toggle.mutate(task)}>{task.enabled ? <LocalizedText text={"停用"} /> : <LocalizedText text={"启用"} />}</button><button className="text-destructive underline" disabled={!active || pending || manualRunPendingId === task.task_id} onClick={() => setDeleteTarget(task)}><LocalizedText text={"删除"} /></button></td>
        </tr>
      })}</tbody></table></div> : <p className="py-8 text-center text-sm text-muted-foreground"><LocalizedText text={"暂无任务定义"} /></p>}
      <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground"><LocalizedText text={"共 "} />{tasks.data?.total ?? 0} <LocalizedText text={" 项"} /></span><div className="flex gap-2"><button className={button} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><LocalizedText text={"上一页"} /></button><span className="px-2 py-2 text-sm"><LocalizedText text={"第 "} />{page} <LocalizedText text={" 页"} /></span><button className={button} disabled={page * 20 >= (tasks.data?.total ?? 0)} onClick={() => setPage((value) => value + 1)}><LocalizedText text={"下一页"} /></button></div></div>
    </section>
    {historyTask && <TaskRunsPanel key={`${tenantId}:${historyTask.task_id}:${manualRun?.tenantId === tenantId && manualRun.task.task_id === historyTask.task_id ? manualRun.run.run_id : ''}`} tenantId={tenantId} actorId={actorId} task={historyTask} initialSelectedRunId={manualRun?.tenantId === tenantId && manualRun.task.task_id === historyTask.task_id ? manualRun.run.run_id : ''} onClose={() => setHistoryTask(null)} />}
    {manualRun?.tenantId === tenantId && <p role="status" aria-live="polite" className="rounded-md border p-3 text-sm">{manualRun.run.status === 'succeeded' ? (isEnglish ? 'Manual run succeeded. The execution record is open.' : '手工运行成功，已打开执行记录。') : manualRun.run.status === 'failed' ? <>{isEnglish ? 'Manual run failed. The execution record is open. Error code: ' : '手工运行失败，已打开执行记录。错误码：'}{manualRun.run.error_code ?? '—'}</> : (isEnglish ? 'The run record was created; the task is still running.' : '已创建运行记录，任务仍在运行中。')}</p>}
    {manualRunPendingId && <p role="status" aria-live="polite" className="rounded-md border p-3 text-sm">{isEnglish ? 'Task is running; waiting for the server to save its execution record…' : '正在运行任务，等待服务端写入执行记录…'}{` ${tasks.data?.items.find((task) => task.task_id === manualRunPendingId)?.task_name ?? ''}`}</p>}
    {manualRunError && <ErrorBox message={manualRunError} />}
    <AlertDialog open={Boolean(runConfirmation)} onOpenChange={(open) => { if (!open && !manualRunPendingId) setRunConfirmation(null) }}>
      <AlertDialogContent className="max-h-[min(80vh,32rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{isEnglish ? 'Run task now' : '确认立即运行任务'}：{runConfirmation?.task_name}</AlertDialogTitle>
          <AlertDialogDescription>{isEnglish ? 'This creates a new execution record immediately and does not change the schedule. Each confirmation starts a separate run. The page cannot cancel a run after it starts.' : '这会立即产生一条新的执行记录，不会修改任务计划。每次确认都会创建一次独立运行。任务开始后，无法通过此页面取消。'}</AlertDialogDescription>
        </AlertDialogHeader>
        {runConfirmation && <dl className="grid gap-2 text-sm sm:grid-cols-2"><DetailItem label="执行目标" value={runConfirmation.execution_target} /><DetailItem label="计划" value={runConfirmation.schedule_type === 'cron' ? `Cron · ${runConfirmation.cron_expression}` : `${runConfirmation.interval_value} ${unitLabels[runConfirmation.interval_unit ?? 'minutes']}`} /><DetailItem label="租户" value={tenant.data?.name ?? tenantId} /></dl>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={Boolean(manualRunPendingId)}>{isEnglish ? 'Cancel' : '取消'}</AlertDialogCancel>
          <AlertDialogAction disabled={!runConfirmation || Boolean(manualRunPendingId)} onClick={(event) => { event.preventDefault(); void confirmManualRun() }}>{isEnglish ? 'Run now' : '确认运行'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <ConfirmDialog
      open={Boolean(deleteTarget)}
      onOpenChange={(open) => { if (!open && !remove.isPending) setDeleteTarget(null) }}
      title='软删除任务'
      desc='删除后任务定义不再参与调度，执行记录会保留。'
      confirmText='确认删除'
      destructive
      isLoading={remove.isPending}
      handleConfirm={() => {
        if (deleteTarget) {
          remove.mutate(deleteTarget.task_id, {
            onSuccess: () => setDeleteTarget(null),
          })
        }
      }}
    >
      {deleteTarget && <p className='text-sm font-medium'>{deleteTarget.task_name}</p>}
    </ConfirmDialog>
  </main>
}

function TaskRunsPanel({ tenantId, actorId, task, initialSelectedRunId, onClose }: { tenantId: string; actorId: string; task: Task; initialSelectedRunId?: string; onClose: () => void }) {
  const [status, setStatus] = useState('')
  const [startedFrom, setStartedFrom] = useState('')
  const [startedTo, setStartedTo] = useState('')
  const [page, setPage] = useState(1)
  const [selectedRunId, setSelectedRunId] = useState(initialSelectedRunId ?? '')
  const params = new URLSearchParams({ page: String(page), page_size: '20' })
  if (status) params.set('status', status)
  if (startedFrom) params.set('started_from', new Date(startedFrom).toISOString())
  if (startedTo) params.set('started_to', new Date(startedTo).toISOString())
  const runsKey = ['synapse', actorId, tenantId, 'tenant', 'scheduled-tasks', 'runs', task.task_id, params.toString()] as const
  const runs = useQuery({
    queryKey: runsKey,
    queryFn: () => listScheduledTaskRuns(tenantId, task.task_id, {
      page: Number(params.get('page') ?? '1'),
      status: params.get('status') as TaskRun['status'] | null ?? undefined,
      startedFrom: params.get('started_from') ?? undefined,
      startedTo: params.get('started_to') ?? undefined,
    }),
  })
  const detailKey = ['synapse', actorId, tenantId, 'tenant', 'scheduled-tasks', 'run', task.task_id, selectedRunId] as const
  const detail = useQuery({
    queryKey: detailKey,
    enabled: Boolean(selectedRunId),
    queryFn: () => getScheduledTaskRun(tenantId, task.task_id, selectedRunId),
  })
  const invalidRange = startedFrom && startedTo && new Date(startedFrom) > new Date(startedTo)
  return <>
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="max-h-[min(85vh,44rem)] overflow-y-auto sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle><LocalizedText text={"执行记录："} />{task.task_name}</DialogTitle>
        <DialogDescription><LocalizedText text={"只显示服务端保存的安全结果摘要或错误码，不包含任务参数、凭据或异常详情。"} /></DialogDescription>
      </DialogHeader>
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-sm"><span><LocalizedText text={"状态"} /></span><LocalizedNativeSelect className={`${input} min-w-36`} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); setSelectedRunId('') }}><option value=""><LocalizedText text={"全部状态"} /></option><option value="running"><LocalizedText text={"运行中"} /></option><option value="succeeded"><LocalizedText text={"成功"} /></option><option value="failed"><LocalizedText text={"失败"} /></option></LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"开始时间从"} /></span><Input className={input} type="datetime-local" value={startedFrom} onChange={(event) => { setStartedFrom(event.target.value); setPage(1); setSelectedRunId('') }} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"到"} /></span><Input className={input} type="datetime-local" value={startedTo} onChange={(event) => { setStartedTo(event.target.value); setPage(1); setSelectedRunId('') }} /></label>
    </div>
    {invalidRange && <ErrorBox message="开始时间范围无效：起始时间不能晚于结束时间。" />}
    {!invalidRange && (runs.isLoading ? <p className="py-5 text-center text-sm text-muted-foreground"><LocalizedText text={"正在加载执行记录…"} /></p> : runs.isError ? <ErrorBox message={errorText(runs.error)} /> : runs.data?.items.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3"><LocalizedText text={"运行 ID"} /></th><th className="p-3"><LocalizedText text={"计划槽"} /></th><th className="p-3"><LocalizedText text={"开始"} /></th><th className="p-3"><LocalizedText text={"结束"} /></th><th className="p-3"><LocalizedText text={"状态"} /></th><th className="p-3"><LocalizedText text={"详情"} /></th></tr></thead><tbody>{runs.data.items.map((run) => <tr className="border-b last:border-0" key={`${run.tenant_id}:${run.task_id}:${run.run_id}`}><td className="p-3">{run.run_id}</td><td className="p-3">{formatTime(run.slot_at)}</td><td className="p-3">{formatTime(run.started_at)}</td><td className="p-3">{run.finished_at ? formatTime(run.finished_at) : <LocalizedText text={"—"} />}</td><td className="p-3">{runStatus[run.status]}</td><td className="p-3"><button className="underline" onClick={() => setSelectedRunId(run.run_id)}>{selectedRunId === run.run_id ? <LocalizedText text={"已选择"} /> : <LocalizedText text={"查看"} />}</button></td></tr>)}</tbody></table></div> : <p className="py-8 text-center text-sm text-muted-foreground"><LocalizedText text={"没有匹配的执行记录"} /></p>)}
    <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground"><LocalizedText text={"共 "} />{runs.data?.total ?? 0} <LocalizedText text={" 条"} /></span><div className="flex gap-2"><button className={button} disabled={page <= 1} onClick={() => { setPage((value) => value - 1); setSelectedRunId('') }}><LocalizedText text={"上一页"} /></button><span className="px-2 py-2 text-sm"><LocalizedText text={"第 "} />{page} <LocalizedText text={" 页"} /></span><button className={button} disabled={page * 20 >= (runs.data?.total ?? 0)} onClick={() => { setPage((value) => value + 1); setSelectedRunId('') }}><LocalizedText text={"下一页"} /></button></div></div>
    </DialogContent>
    </Dialog>
    <Dialog open={Boolean(selectedRunId)} onOpenChange={(open) => { if (!open) setSelectedRunId('') }}>
      <DialogContent className="max-h-[min(80vh,36rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle><LocalizedText text={"运行详情"} /></DialogTitle>
          <DialogDescription>{task.task_name}</DialogDescription>
        </DialogHeader>
        <div aria-live="polite">
          {detail.isLoading ? <p className="text-sm text-muted-foreground"><LocalizedText text={"正在加载详情…"} /></p> : detail.isError ? <ErrorBox message={errorText(detail.error)} /> : detail.data && <dl className="grid gap-3 text-sm sm:grid-cols-2"><DetailItem label="目标" value={detail.data.execution_target} /><DetailItem label="状态" value={runStatus[detail.data.status]} /><DetailItem label="开始时间" value={formatTime(detail.data.started_at)} /><DetailItem label="结束时间" value={detail.data.finished_at ? formatTime(detail.data.finished_at) : '—'} /><DetailItem label="错误码" value={detail.data.error_code ?? '—'} /><div className="sm:col-span-2"><dt className="text-muted-foreground"><LocalizedText text={"安全结果摘要"} /></dt><dd className="mt-1"><pre className="overflow-x-auto rounded bg-muted/30 p-3 text-xs">{detail.data.result_summary ? JSON.stringify(detail.data.result_summary, null, 2) : <LocalizedText text={"—"} />}</pre></dd></div></dl>}
        </div>
      </DialogContent>
    </Dialog>
  </>
}

const runStatus: Record<TaskRun['status'], string> = { running: '运行中', succeeded: '成功', failed: '失败' }
function DetailItem({ label, value }: { label: string; value: string }) { return <div><dt className="text-muted-foreground"><LocalizedText text={label} /></dt><dd className="mt-1 break-all">{value}</dd></div> }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }) }

function TaskEditor({ draft, targets, pending, error, onChange, onCancel, onSave }: {
  draft: TaskDraft; targets: Target[]; pending: boolean; error: string; onChange: (draft: TaskDraft) => void; onCancel: () => void; onSave: () => void
}) {
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => onChange({ ...draft, [key]: value })
  return <FormDialog
    open
    onOpenChange={(open) => { if (!open) onCancel() }}
    title={draft.task_id ? <LocalizedText text={"编辑任务"} /> : <LocalizedText text={"创建任务"} />}
    formAriaLabel={draft.task_id ? '编辑任务' : '创建任务'}
    description="从平台 allowlist 选择执行目标，并配置服务端可校验的调度计划。"
    error={error}
    submitLabel={draft.task_id ? <LocalizedText text={"保存任务"} /> : <LocalizedText text={"创建任务"} />}
    pending={pending}
    disabled={targets.length === 0}
    onSubmit={onSave}
    onCancel={onCancel}
  >
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm"><span><LocalizedText text={"任务名称"} /></span><Input className={input} required maxLength={120} value={draft.task_name} onChange={(event) => set('task_name', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"执行目标"} /></span><LocalizedNativeSelect className={input} required value={draft.execution_target} onChange={(event) => set('execution_target', event.target.value)}><option value="" disabled><LocalizedText text={"选择 allowlist 目标"} /></option>{targets.map((target) => <option key={target.target_id} value={target.target_id}>{target.name} <LocalizedText text={" · "} />{target.target_id}</option>)}</LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"计划类型"} /></span><LocalizedNativeSelect className={input} value={draft.schedule_type} onChange={(event) => set('schedule_type', event.target.value as TaskDraft['schedule_type'])}><option value="cron"><LocalizedText text={"Cron"} /></option><option value="interval"><LocalizedText text={"固定间隔"} /></option></LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"IANA 时区"} /></span><Input className={input} required maxLength={64} value={draft.timezone} placeholder="UTC 或 Asia/Shanghai" onChange={(event) => set('timezone', event.target.value)} /></label>
      {draft.schedule_type === 'cron' ? <label className="space-y-1 text-sm sm:col-span-2"><span><LocalizedText text={"五字段 Cron 表达式"} /></span><Input className={`${input} font-mono`} required maxLength={120} value={draft.cron_expression} placeholder="例如：0 2 * * *" onChange={(event) => set('cron_expression', event.target.value)} /><span className="block text-xs text-muted-foreground"><LocalizedText text={"按所选 IANA 时区计算；服务端会校验表达式。"} /></span></label> : <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2"><label className="space-y-1 text-sm"><span><LocalizedText text={"间隔数值"} /></span><Input className={input} required type="number" min={1} max={31536000} step={1} value={draft.interval_value} onChange={(event) => set('interval_value', event.target.value)} /></label><label className="space-y-1 text-sm"><span><LocalizedText text={"间隔单位"} /></span><LocalizedNativeSelect className={input} value={draft.interval_unit} onChange={(event) => set('interval_unit', event.target.value as TaskDraft['interval_unit'])}>{intervalUnits.map((unit) => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}</LocalizedNativeSelect><span className="block text-xs text-muted-foreground"><LocalizedText text={"有效范围为 10 秒至 365 天。"} /></span></label></div>}
      <label className="space-y-1 text-sm sm:col-span-2"><span><LocalizedText text={"说明（可选）"} /></span><textarea className="min-h-20 w-full rounded-md border bg-background p-3 text-sm" maxLength={1000} value={draft.description} onChange={(event) => set('description', event.target.value)} /></label>
      {!draft.task_id && <label className="flex items-center gap-2 text-sm"><Input type="checkbox" checked={draft.enabled} onChange={(event) => set('enabled', event.target.checked)} /><LocalizedText text={"创建后启用"} /></label>}
    </div>
  </FormDialog>
}

function emptyDraft(targetId: string): TaskDraft {
  return { task_name: '', description: '', execution_target: targetId, schedule_type: 'cron', cron_expression: '0 2 * * *', interval_value: '60', interval_unit: 'minutes', timezone: 'UTC', enabled: true, parameters: {} }
}

function toDraft(task: Task): TaskDraft {
  return { task_id: task.task_id, task_name: task.task_name, description: task.description ?? '', execution_target: task.execution_target, schedule_type: task.schedule_type, cron_expression: task.cron_expression ?? '', interval_value: String(task.interval_value ?? 60), interval_unit: task.interval_unit ?? 'minutes', timezone: task.timezone, enabled: task.enabled, parameters: task.parameters }
}

function ErrorBox({ message }: { message: string }) { return <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{message}</div> }
function errorText(error: unknown) {
  if (error instanceof ApiProblem) return `${error.message}${error.code ? `（${error.code}）` : ''}`
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}
function manualRunErrorText(error: unknown) {
  const english = getLocale() === 'en'
  if (error instanceof ApiProblem) {
    if (error.status === 409 && error.code === 'TASK_ALREADY_RUNNING') return english ? 'A scheduled run is already in progress. Check the run history again shortly.' : '该任务已有正在执行的计划运行，请稍后查看执行记录。'
    if (error.status === 409 && error.code === 'TASK_UNAVAILABLE') return english ? 'This task cannot run now. It may be disabled or unavailable; refresh the task list.' : '任务当前不可运行，可能已停用或不可用；请刷新任务列表。'
    if (error.status === 404) return english ? 'This task was not found or is no longer available. Refresh the list.' : '任务不存在或已不可用，请刷新列表。'
    if (error.status === 403) return english ? 'You are not allowed to run this task in the current tenant.' : '你无权在当前租户运行此任务。'
    if (error.status >= 500 || error.status === 408 || error.status === 504) return uncertainRunMessage(english)
    if (error.status === 0) return english ? 'The server may have received the request. Check run history before deciding whether to retry, to avoid a duplicate run.' : '未能确认请求是否到达服务器。请先查看执行记录，再决定是否重试，避免重复运行。'
  }
  if (error instanceof TypeError) return uncertainRunMessage(english)
  return errorText(error)
}
function uncertainRunMessage(english: boolean) {
  return english ? 'The request outcome is uncertain. Check run history before deciding whether to retry, to avoid a duplicate run.' : '请求结果不确定。请先查看执行记录，再决定是否重试，避免重复运行。'
}
