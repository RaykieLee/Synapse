import { useState } from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { Input } from '@/components/ui/input'
import { formatMessage } from '@/lib/i18n'
import { Link, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getTenant } from '@/api/tenants'
import { ApiProblem, api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { LocalizedText } from '@/components/localized-text'

type Task = {
  task_id: string; tenant_id: string; task_name: string; description: string | null; execution_target: string
  parameters: Record<string, string | number | boolean | null>; schedule_type: 'cron' | 'interval'
  cron_expression: string | null; interval_value: number | null; interval_unit: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | null
  timezone: string; enabled: boolean; created_at: string; updated_at: string
}
type TaskPage = { items: Task[]; total: number; page: number; page_size: number }
type Target = { target_id: string; name: string; description: string; scope: string }
type TaskRun = {
  run_id: string; tenant_id: string; task_id: string; slot_at: string; execution_target: string
  started_at: string; finished_at: string | null; status: 'running' | 'succeeded' | 'failed'
  result_summary: Record<string, unknown> | null; error_code: string | null
}
type RunPage = { items: TaskRun[]; total: number; page: number; page_size: number }
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
  const actor = useAuthStore((state) => state.auth.user)
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId/scheduled-tasks' })
  const client = useQueryClient()
  const actorId = actor?.user_id ?? 'anonymous'
  const [draft, setDraft] = useState<TaskDraft | null>(null)
  const [historyTask, setHistoryTask] = useState<Task | null>(null)
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
  const listKey = ['synapse', actorId, tenantId, 'tenant', 'scheduled-tasks', 'list', page, search.trim(), targetFilter, scheduleFilter, enabledFilter] as const
  const tasks = useQuery({
    queryKey: listKey,
    enabled: canManage && active,
    queryFn: () => api<TaskPage>(`/tenants/${tenantId}/scheduled-tasks?${params}`),
  })
  const targetKey = ['synapse', actorId, tenantId, 'tenant', 'scheduled-tasks', 'targets'] as const
  const targets = useQuery({
    queryKey: targetKey,
    enabled: canManage && active,
    queryFn: () => api<{ items: Target[] }>(`/tenants/${tenantId}/scheduled-tasks/targets`),
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
        ? api<Task>(`/tenants/${tenantId}/scheduled-tasks/${value.task_id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api<Task>(`/tenants/${tenantId}/scheduled-tasks`, { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: async () => { setDraft(null); setError(''); await invalidate() },
    onError: (cause) => setError(errorText(cause)),
  })
  const toggle = useMutation({
    mutationFn: (task: Task) => api<Task>(`/tenants/${tenantId}/scheduled-tasks/${task.task_id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !task.enabled }) }),
    onSuccess: async () => { setError(''); await invalidate() },
    onError: (cause) => setError(errorText(cause)),
  })
  const remove = useMutation({
    mutationFn: (taskId: string) => api<void>(`/tenants/${tenantId}/scheduled-tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: async () => { setError(''); await invalidate() },
    onError: (cause) => setError(errorText(cause)),
  })

  if (tenant.isLoading) return <main className="p-6"><LocalizedText text={"正在加载租户…"} /></main>
  if (tenant.isError) return <main className="space-y-4 p-6"><Link className="underline" to="/tenants/$tenantId" params={{ tenantId }}><LocalizedText text={"返回租户"} /></Link><ErrorBox message={errorText(tenant.error)} /></main>
  if (!canManage) return <main className="space-y-4 p-6"><Link className="underline" to="/tenants/$tenantId" params={{ tenantId }}><LocalizedText text={"返回租户"} /></Link><ErrorBox message="仅租户所有者或管理员可以管理系统任务定义。" /></main>

  const pending = save.isPending || toggle.isPending || remove.isPending
  return <main className="space-y-5 p-6">
    <Link className="text-sm underline" to="/tenants/$tenantId" params={{ tenantId }}><LocalizedText text={"← 返回 "} />{tenant.data?.name}</Link>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold"><LocalizedText text={"系统任务定义"} /></h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground"><LocalizedText text={"配置当前租户的 cron 或间隔任务。执行目标来自平台 allowlist；编辑计划会由服务端校验完整定义。"} /></p></div>
      <button className={primary} disabled={!active || targets.isError} onClick={() => { setError(''); setDraft(emptyDraft(targets.data?.items[0]?.target_id ?? '')) }}><LocalizedText text={"创建任务"} /></button>
    </header>
    {!active && <ErrorBox message="租户未启用，任务定义只读。" />}
    {error && <ErrorBox message={error} />}
    {targets.isError && <ErrorBox message={`读取允许的执行目标失败：${errorText(targets.error)}`} />}
    {draft && <TaskEditor draft={draft} targets={targets.data?.items ?? []} pending={save.isPending} onChange={setDraft} onCancel={() => setDraft(null)} onSave={() => save.mutate(draft)} />}
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
          <td className="space-x-3 whitespace-nowrap p-3"><button className="underline" onClick={() => setHistoryTask(task)}><LocalizedText text={"执行记录"} /></button><button className="underline" disabled={!active || pending} onClick={() => { setError(''); setDraft(toDraft(task)) }}><LocalizedText text={"编辑"} /></button><button className="underline" disabled={!active || pending} onClick={() => toggle.mutate(task)}>{task.enabled ? <LocalizedText text={"停用"} /> : <LocalizedText text={"启用"} />}</button><button className="text-destructive underline" disabled={!active || pending} onClick={() => { if (window.confirm(formatMessage('软删除任务“{name}”？', { name: task.task_name }))) remove.mutate(task.task_id) }}><LocalizedText text={"删除"} /></button></td>
        </tr>
      })}</tbody></table></div> : <p className="py-8 text-center text-sm text-muted-foreground"><LocalizedText text={"暂无任务定义"} /></p>}
      <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground"><LocalizedText text={"共 "} />{tasks.data?.total ?? 0} <LocalizedText text={" 项"} /></span><div className="flex gap-2"><button className={button} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><LocalizedText text={"上一页"} /></button><span className="px-2 py-2 text-sm"><LocalizedText text={"第 "} />{page} <LocalizedText text={" 页"} /></span><button className={button} disabled={page * 20 >= (tasks.data?.total ?? 0)} onClick={() => setPage((value) => value + 1)}><LocalizedText text={"下一页"} /></button></div></div>
    </section>
    {historyTask && <TaskRunsPanel key={`${tenantId}:${historyTask.task_id}`} tenantId={tenantId} actorId={actorId} task={historyTask} onClose={() => setHistoryTask(null)} />}
  </main>
}

function TaskRunsPanel({ tenantId, actorId, task, onClose }: { tenantId: string; actorId: string; task: Task; onClose: () => void }) {
  const [status, setStatus] = useState('')
  const [startedFrom, setStartedFrom] = useState('')
  const [startedTo, setStartedTo] = useState('')
  const [page, setPage] = useState(1)
  const [selectedRunId, setSelectedRunId] = useState('')
  const params = new URLSearchParams({ page: String(page), page_size: '20' })
  if (status) params.set('status', status)
  if (startedFrom) params.set('started_from', new Date(startedFrom).toISOString())
  if (startedTo) params.set('started_to', new Date(startedTo).toISOString())
  const runsKey = ['synapse', actorId, tenantId, 'tenant', 'scheduled-tasks', 'runs', task.task_id, page, status, startedFrom, startedTo] as const
  const runs = useQuery({ queryKey: runsKey, queryFn: () => api<RunPage>(`/tenants/${tenantId}/scheduled-tasks/${task.task_id}/runs?${params}`) })
  const detailKey = ['synapse', actorId, tenantId, 'tenant', 'scheduled-tasks', 'run', task.task_id, selectedRunId] as const
  const detail = useQuery({
    queryKey: detailKey,
    enabled: Boolean(selectedRunId),
    queryFn: () => api<TaskRun>(`/tenants/${tenantId}/scheduled-tasks/${task.task_id}/runs/${selectedRunId}`),
  })
  const invalidRange = startedFrom && startedTo && new Date(startedFrom) > new Date(startedTo)
  return <section className={`${panel} space-y-4`}>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold"><LocalizedText text={"执行记录："} />{task.task_name}</h2><p className="text-sm text-muted-foreground"><LocalizedText text={"只显示服务端保存的安全结果摘要或错误码，不包含任务参数、凭据或异常详情。"} /></p></div><button className={button} onClick={onClose}><LocalizedText text={"关闭"} /></button></header>
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-sm"><span><LocalizedText text={"状态"} /></span><LocalizedNativeSelect className={`${input} min-w-36`} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); setSelectedRunId('') }}><option value=""><LocalizedText text={"全部状态"} /></option><option value="running"><LocalizedText text={"运行中"} /></option><option value="succeeded"><LocalizedText text={"成功"} /></option><option value="failed"><LocalizedText text={"失败"} /></option></LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"开始时间从"} /></span><Input className={input} type="datetime-local" value={startedFrom} onChange={(event) => { setStartedFrom(event.target.value); setPage(1); setSelectedRunId('') }} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"到"} /></span><Input className={input} type="datetime-local" value={startedTo} onChange={(event) => { setStartedTo(event.target.value); setPage(1); setSelectedRunId('') }} /></label>
    </div>
    {invalidRange && <ErrorBox message="开始时间范围无效：起始时间不能晚于结束时间。" />}
    {!invalidRange && (runs.isLoading ? <p className="py-5 text-center text-sm text-muted-foreground"><LocalizedText text={"正在加载执行记录…"} /></p> : runs.isError ? <ErrorBox message={errorText(runs.error)} /> : runs.data?.items.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3"><LocalizedText text={"运行 ID"} /></th><th className="p-3"><LocalizedText text={"计划槽"} /></th><th className="p-3"><LocalizedText text={"开始"} /></th><th className="p-3"><LocalizedText text={"结束"} /></th><th className="p-3"><LocalizedText text={"状态"} /></th><th className="p-3"><LocalizedText text={"详情"} /></th></tr></thead><tbody>{runs.data.items.map((run) => <tr className="border-b last:border-0" key={`${run.tenant_id}:${run.task_id}:${run.run_id}`}><td className="p-3">{run.run_id}</td><td className="p-3">{formatTime(run.slot_at)}</td><td className="p-3">{formatTime(run.started_at)}</td><td className="p-3">{run.finished_at ? formatTime(run.finished_at) : <LocalizedText text={"—"} />}</td><td className="p-3">{runStatus[run.status]}</td><td className="p-3"><button className="underline" onClick={() => setSelectedRunId(run.run_id)}>{selectedRunId === run.run_id ? <LocalizedText text={"已选择"} /> : <LocalizedText text={"查看"} />}</button></td></tr>)}</tbody></table></div> : <p className="py-8 text-center text-sm text-muted-foreground"><LocalizedText text={"没有匹配的执行记录"} /></p>)}
    {selectedRunId && <div className="rounded-md border bg-muted/20 p-4" aria-live="polite"><h3 className="font-medium"><LocalizedText text={"运行详情"} /></h3>{detail.isLoading ? <p className="mt-2 text-sm text-muted-foreground"><LocalizedText text={"正在加载详情…"} /></p> : detail.isError ? <ErrorBox message={errorText(detail.error)} /> : detail.data && <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><DetailItem label="目标" value={detail.data.execution_target} /><DetailItem label="状态" value={runStatus[detail.data.status]} /><DetailItem label="开始时间" value={formatTime(detail.data.started_at)} /><DetailItem label="结束时间" value={detail.data.finished_at ? formatTime(detail.data.finished_at) : '—'} /><DetailItem label="错误码" value={detail.data.error_code ?? '—'} /><div className="sm:col-span-2"><dt className="text-muted-foreground"><LocalizedText text={"安全结果摘要"} /></dt><dd className="mt-1"><pre className="overflow-x-auto rounded bg-background p-3 text-xs">{detail.data.result_summary ? JSON.stringify(detail.data.result_summary, null, 2) : <LocalizedText text={"—"} />}</pre></dd></div></dl>}</div>}
    <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground"><LocalizedText text={"共 "} />{runs.data?.total ?? 0} <LocalizedText text={" 条"} /></span><div className="flex gap-2"><button className={button} disabled={page <= 1} onClick={() => { setPage((value) => value - 1); setSelectedRunId('') }}><LocalizedText text={"上一页"} /></button><span className="px-2 py-2 text-sm"><LocalizedText text={"第 "} />{page} <LocalizedText text={" 页"} /></span><button className={button} disabled={page * 20 >= (runs.data?.total ?? 0)} onClick={() => { setPage((value) => value + 1); setSelectedRunId('') }}><LocalizedText text={"下一页"} /></button></div></div>
  </section>
}

const runStatus: Record<TaskRun['status'], string> = { running: '运行中', succeeded: '成功', failed: '失败' }
function DetailItem({ label, value }: { label: string; value: string }) { return <div><dt className="text-muted-foreground"><LocalizedText text={label} /></dt><dd className="mt-1 break-all">{value}</dd></div> }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }) }

function TaskEditor({ draft, targets, pending, onChange, onCancel, onSave }: {
  draft: TaskDraft; targets: Target[]; pending: boolean; onChange: (draft: TaskDraft) => void; onCancel: () => void; onSave: () => void
}) {
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => onChange({ ...draft, [key]: value })
  return <form className={`${panel} space-y-4`} onSubmit={(event) => { event.preventDefault(); onSave() }}>
    <h2 className="font-semibold">{draft.task_id ? <LocalizedText text={"编辑任务"} /> : <LocalizedText text={"创建任务"} />}</h2>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm"><span><LocalizedText text={"任务名称"} /></span><Input className={input} required maxLength={120} value={draft.task_name} onChange={(event) => set('task_name', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"执行目标"} /></span><LocalizedNativeSelect className={input} required value={draft.execution_target} onChange={(event) => set('execution_target', event.target.value)}><option value="" disabled><LocalizedText text={"选择 allowlist 目标"} /></option>{targets.map((target) => <option key={target.target_id} value={target.target_id}>{target.name} <LocalizedText text={" · "} />{target.target_id}</option>)}</LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"计划类型"} /></span><LocalizedNativeSelect className={input} value={draft.schedule_type} onChange={(event) => set('schedule_type', event.target.value as TaskDraft['schedule_type'])}><option value="cron"><LocalizedText text={"Cron"} /></option><option value="interval"><LocalizedText text={"固定间隔"} /></option></LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"IANA 时区"} /></span><Input className={input} required maxLength={64} value={draft.timezone} placeholder="UTC 或 Asia/Shanghai" onChange={(event) => set('timezone', event.target.value)} /></label>
      {draft.schedule_type === 'cron' ? <label className="space-y-1 text-sm sm:col-span-2"><span><LocalizedText text={"五字段 Cron 表达式"} /></span><Input className={`${input} font-mono`} required maxLength={120} value={draft.cron_expression} placeholder="例如：0 2 * * *" onChange={(event) => set('cron_expression', event.target.value)} /><span className="block text-xs text-muted-foreground"><LocalizedText text={"按所选 IANA 时区计算；服务端会校验表达式。"} /></span></label> : <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2"><label className="space-y-1 text-sm"><span><LocalizedText text={"间隔数值"} /></span><Input className={input} required type="number" min={1} max={31536000} step={1} value={draft.interval_value} onChange={(event) => set('interval_value', event.target.value)} /></label><label className="space-y-1 text-sm"><span><LocalizedText text={"间隔单位"} /></span><LocalizedNativeSelect className={input} value={draft.interval_unit} onChange={(event) => set('interval_unit', event.target.value as TaskDraft['interval_unit'])}>{intervalUnits.map((unit) => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}</LocalizedNativeSelect><span className="block text-xs text-muted-foreground"><LocalizedText text={"有效范围为 10 秒至 365 天。"} /></span></label></div>}
      <label className="space-y-1 text-sm sm:col-span-2"><span><LocalizedText text={"说明（可选）"} /></span><textarea className="min-h-20 w-full rounded-md border bg-background p-3 text-sm" maxLength={1000} value={draft.description} onChange={(event) => set('description', event.target.value)} /></label>
      {!draft.task_id && <label className="flex items-center gap-2 text-sm"><Input type="checkbox" checked={draft.enabled} onChange={(event) => set('enabled', event.target.checked)} /><LocalizedText text={"创建后启用"} /></label>}
    </div>
    <div className="flex gap-2"><button className={primary} disabled={pending || targets.length === 0}>{pending ? <LocalizedText text={"保存中…"} /> : <LocalizedText text={"保存"} />}</button><button type="button" className={button} onClick={onCancel}><LocalizedText text={"取消"} /></button></div>
  </form>
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
