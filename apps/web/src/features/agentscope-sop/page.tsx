import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  CheckCircle2,
  CircleAlert,
  Eye,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react'

import {
  createSop,
  deleteSop,
  deleteSopRun,
  getSopRun,
  getSopSchema,
  listSopEditorAgents,
  listSopEditorCredentials,
  listSopRuns,
  listSops,
  startSopRun,
  submitSopVerdict,
  updateSop,
  type JsonObject,
  type SopData,
  type SopRecord,
  type SopRun,
} from './api'
import {
  collectSchemaIssues,
  normalizeForSchema,
  schemaDefault,
  SchemaDrivenEditor,
  type JsonSchema,
} from './schema-editor'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { FormDialog } from '@/components/form-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useWorkspace } from '@/features/workspaces/context'

const panel = 'rounded-xl border bg-card p-5'

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试。'
}

function formatDate(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString()
}

function statusLabel(value?: string) {
  const labels: Record<string, string> = {
    pending: '待运行',
    running: '运行中',
    awaiting: '等待人工',
    completed: '已完成',
    failed: '失败',
  }
  return labels[value ?? ''] ?? value ?? '未知'
}

function statusClass(value?: string) {
  if (value === 'completed') return 'bg-emerald-500/10 text-emerald-700'
  if (value === 'failed') return 'bg-destructive/10 text-destructive'
  if (value === 'awaiting') return 'bg-amber-500/15 text-amber-800'
  if (value === 'running') return 'bg-blue-500/10 text-blue-700'
  return 'bg-muted text-muted-foreground'
}

function readSchema(value: unknown) {
  return value && typeof value === 'object'
    ? (value as JsonObject & JsonSchema)
    : null
}

function initialSop(schema: JsonObject): SopData {
  const value = schemaDefault(schema, schema)
  return normalizeForSchema(schema, schema, value) as SopData
}

function parseJsonArray(value: string, label: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${label} 必须是有效 JSON。`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} 必须是 JSON 数组。`)
  return parsed
}

export function AgentScopeSopPage() {
  const { workspace } = useWorkspace()
  const workspaceId = workspace.workspace_id
  const client = useQueryClient()
  const [selectedSop, setSelectedSop] = React.useState<SopRecord | null>(null)
  const [editorValue, setEditorValue] = React.useState<SopData | null>(null)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editorInvalid, setEditorInvalid] = React.useState(true)
  const [deleteTarget, setDeleteTarget] = React.useState<SopRecord | null>(null)
  const [runTarget, setRunTarget] = React.useState<SopRecord | null>(null)
  const [runInputs, setRunInputs] = React.useState('[]')
  const [runError, setRunError] = React.useState('')
  const [selectedRunId, setSelectedRunId] = React.useState('')
  const [verdictTarget, setVerdictTarget] = React.useState<{
    run: SopRun
    stepIndex: number
  } | null>(null)
  const [verdictMessage, setVerdictMessage] = React.useState('')
  const [verdictPassed, setVerdictPassed] = React.useState(true)

  const schemaQuery = useQuery({
    queryKey: ['agentscope', workspaceId, 'sop-schema'],
    queryFn: () => getSopSchema(workspaceId),
  })
  const sopsQuery = useQuery({
    queryKey: ['agentscope', workspaceId, 'sops'],
    queryFn: () => listSops(workspaceId),
  })
  const agentsQuery = useQuery({
    queryKey: ['agentscope', workspaceId, 'sop-editor-agents'],
    queryFn: () => listSopEditorAgents(workspaceId),
  })
  const credentialsQuery = useQuery({
    queryKey: ['agentscope', workspaceId, 'sop-editor-credentials'],
    queryFn: () => listSopEditorCredentials(workspaceId),
  })
  const runsQuery = useQuery({
    queryKey: ['agentscope', workspaceId, 'sop-runs', selectedSop?.id ?? 'all'],
    queryFn: () => listSopRuns(workspaceId, { sopId: selectedSop?.id }),
  })
  const runDetailQuery = useQuery({
    queryKey: ['agentscope', workspaceId, 'sop-run', selectedRunId],
    queryFn: () => getSopRun(workspaceId, selectedRunId),
    enabled: Boolean(selectedRunId),
    refetchInterval: (query) => {
      const phase = query.state.data?.state?.phase
      return phase === 'running' || phase === 'awaiting' ? 2500 : false
    },
  })

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({
        queryKey: ['agentscope', workspaceId, 'sops'],
      }),
      client.invalidateQueries({
        queryKey: ['agentscope', workspaceId, 'sop-runs'],
      }),
    ])
  }

  const save = useMutation({
    mutationFn: async (value: { id?: string; data: SopData }) =>
      value.id
        ? updateSop(workspaceId, value.id, value.data)
        : createSop(workspaceId, value.data),
    onSuccess: async () => {
      setEditorOpen(false)
      setEditorValue(null)
      setSelectedSop(null)
      await refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (record: SopRecord) => deleteSop(workspaceId, record.id),
    onSuccess: async () => {
      if (selectedSop?.id === deleteTarget?.id) setSelectedSop(null)
      setDeleteTarget(null)
      await refresh()
    },
  })
  const start = useMutation({
    mutationFn: async () => {
      if (!runTarget) throw new Error('请选择一个 SOP。')
      return startSopRun(
        workspaceId,
        runTarget.id,
        parseJsonArray(runInputs, '启动输入')
      )
    },
    onSuccess: async (run) => {
      setRunTarget(null)
      setRunError('')
      setSelectedRunId(run.id)
      await refresh()
      await client.invalidateQueries({
        queryKey: ['agentscope', workspaceId, 'sop-run', run.id],
      })
    },
    onError: (cause) => setRunError(errorText(cause)),
  })
  const verdict = useMutation({
    mutationFn: async () => {
      if (!verdictTarget) throw new Error('请选择待处理步骤。')
      return submitSopVerdict(workspaceId, verdictTarget.run.id, {
        step_index: verdictTarget.stepIndex,
        passed: verdictPassed,
        message: verdictMessage,
      })
    },
    onSuccess: async (run) => {
      setVerdictTarget(null)
      setVerdictMessage('')
      setSelectedRunId(run.id)
      await refresh()
      await client.invalidateQueries({
        queryKey: ['agentscope', workspaceId, 'sop-run', run.id],
      })
    },
  })
  const removeRun = useMutation({
    mutationFn: (runId: string) => deleteSopRun(workspaceId, runId),
    onSuccess: async () => {
      setSelectedRunId('')
      await refresh()
    },
  })

  const schema = readSchema(schemaQuery.data?.schema)
  const items = sopsQuery.data?.sops ?? []
  const runs = runsQuery.data?.runs ?? []
  const runDetail = runDetailQuery.data
  const editorResources = {
    agents: agentsQuery.data ?? [],
    credentials: credentialsQuery.data ?? [],
  }

  const openCreate = () => {
    if (!schema) return
    setSelectedSop(null)
    setEditorValue(initialSop(schema))
    setEditorInvalid(true)
    setEditorOpen(true)
  }

  const openEdit = (record: SopRecord) => {
    if (!schema) return
    setSelectedSop(record)
    setEditorValue(
      normalizeForSchema(schema, schema, record.data) as SopData
    )
    setEditorInvalid(false)
    setEditorOpen(true)
  }

  const schemaIssues =
    editorValue && schema
      ? collectSchemaIssues(schema, schema, editorValue)
      : []

  return (
    <main className='space-y-6 p-6'>
      <header className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <p className='text-sm text-muted-foreground'>AgentScope / Workflow</p>
          <h1 className='mt-1 text-2xl font-semibold'>SOP 流程</h1>
          <p className='mt-1 max-w-3xl text-sm text-muted-foreground'>
            用 AgentScope 后端真实 JSON Schema 编排多步骤流程，启动运行后可跟踪每个步骤并处理人工审核。
          </p>
        </div>
        <Button onClick={openCreate} disabled={!schema}>
          <Plus className='mr-2 size-4' />
          新建 SOP
        </Button>
      </header>

      {(schemaQuery.isError ||
        sopsQuery.isError ||
        agentsQuery.isError ||
        credentialsQuery.isError) && (
        <div role='alert' className='rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'>
          {errorText(
            schemaQuery.error ??
              sopsQuery.error ??
              agentsQuery.error ??
              credentialsQuery.error
          )}
        </div>
      )}

      <section className='grid gap-4 md:grid-cols-3'>
        <MetricCard label='SOP 数量' value={sopsQuery.data?.total ?? 0} icon={<Activity />} />
        <MetricCard
          label='待人工处理'
          value={runs.filter((run) => run.state?.phase === 'awaiting').length}
          icon={<CircleAlert />}
          accent='amber'
        />
        <MetricCard
          label='近期运行'
          value={runs.length}
          icon={<RefreshCw />}
          accent='blue'
        />
      </section>

      <section className={`${panel} space-y-4`}>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h2 className='font-semibold'>SOP 定义</h2>
            <p className='text-sm text-muted-foreground'>
              编辑器字段直接由 `/api/v1/ai/sop/schema` 驱动。
            </p>
          </div>
          <Button
            variant='outline'
            size='sm'
            onClick={() => sopsQuery.refetch()}
            disabled={sopsQuery.isFetching}
          >
            <RefreshCw className={`mr-2 size-3.5 ${sopsQuery.isFetching ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
        {sopsQuery.isLoading ? (
          <p className='py-8 text-center text-sm text-muted-foreground'>正在加载 SOP…</p>
        ) : items.length ? (
          <div className='grid gap-3 lg:grid-cols-2'>
            {items.map((record) => (
              <div
                key={record.id}
                className={`rounded-lg border p-4 transition-colors ${
                  selectedSop?.id === record.id ? 'border-primary ring-1 ring-primary/30' : ''
                }`}
              >
                <button
                  type='button'
                  className='w-full text-left'
                  onClick={() => setSelectedSop(record)}
                >
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <h3 className='truncate font-medium'>{record.data.name}</h3>
                      <p className='mt-1 line-clamp-2 text-sm text-muted-foreground'>
                        {record.data.description || '暂无描述'}
                      </p>
                    </div>
                    <span className='shrink-0 rounded-full bg-muted px-2 py-1 text-xs'>
                      {record.data.steps.length} 步
                    </span>
                  </div>
                </button>
                <div className='mt-4 flex flex-wrap gap-2'>
                  <Button size='sm' onClick={() => setRunTarget(record)}>
                    <Play className='mr-1 size-3.5' />
                    启动运行
                  </Button>
                  <Button size='sm' variant='outline' onClick={() => openEdit(record)}>
                    <Pencil className='mr-1 size-3.5' />
                    编辑
                  </Button>
                  <Button size='sm' variant='outline' onClick={() => setSelectedSop(record)}>
                    <Eye className='mr-1 size-3.5' />
                    查看运行
                  </Button>
                  <Button
                    size='sm'
                    variant='destructive'
                    onClick={() => setDeleteTarget(record)}
                  >
                    <Trash2 className='mr-1 size-3.5' />
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className='rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground'>
            当前 Workspace 还没有 SOP。创建一个流程后，可从这里启动真实运行。
          </div>
        )}
      </section>

      <section className={`${panel} space-y-4`}>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h2 className='font-semibold'>
              {selectedSop ? `${selectedSop.data.name} 的运行` : '最近运行'}
            </h2>
            <p className='text-sm text-muted-foreground'>
              {selectedSop ? '运行快照独立于后续 SOP 编辑。' : '选择一个 SOP 可只查看它的运行。'}
            </p>
          </div>
          {selectedSop && (
            <Button size='sm' variant='ghost' onClick={() => setSelectedSop(null)}>
              查看全部
            </Button>
          )}
        </div>
        {runsQuery.isLoading ? (
          <p className='py-8 text-center text-sm text-muted-foreground'>正在加载运行记录…</p>
        ) : runs.length ? (
          <div className='space-y-2'>
            {runs.map((run) => (
              <div
                key={run.id}
                className='flex flex-wrap items-center justify-between gap-3 rounded-md border p-3'
              >
                <button
                  type='button'
                  className='min-w-0 flex-1 text-left'
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-mono text-xs'>{run.id}</span>
                    <span className={`rounded-full px-2 py-1 text-xs ${statusClass(run.state?.phase)}`}>
                      {statusLabel(run.state?.phase)}
                    </span>
                  </div>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    {formatDate(run.state?.created_at ?? run.created_at)}
                  </p>
                </button>
                <div className='flex items-center gap-2'>
                  <Button size='sm' variant='outline' onClick={() => setSelectedRunId(run.id)}>
                    <Eye className='mr-1 size-3.5' />
                    详情
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='text-destructive'
                    onClick={() => removeRun.mutate(run.id)}
                    disabled={removeRun.isPending}
                  >
                    <Trash2 className='size-3.5' />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className='rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground'>
            暂无运行记录。
          </p>
        )}
      </section>

      <FormDialog
        open={editorOpen}
        onOpenChange={(open) => !open && setEditorOpen(false)}
        title={selectedSop ? `编辑 SOP：${selectedSop.data.name}` : '新建 SOP'}
        description='表单字段来自 AgentScope 官方 SOP JSON Schema；会话模型配置中的 credential_id 必须来自当前 Workspace。'
        error={save.error ? errorText(save.error) : undefined}
        pending={save.isPending}
        disabled={!editorValue || editorInvalid || schemaIssues.length > 0}
        formAriaLabel='SOP 编辑器'
        submitLabel={selectedSop ? '保存修改' : '创建 SOP'}
        onCancel={() => setEditorOpen(false)}
        onSubmit={() =>
          editorValue &&
          save.mutate({ id: selectedSop?.id, data: editorValue })
        }
      >
        {schema && editorValue && (
          <SchemaDrivenEditor
            schema={schema}
            value={editorValue}
            resources={editorResources}
            onChange={(value) =>
              setEditorValue(normalizeForSchema(schema, schema, value) as SopData)
            }
            onValidationChange={setEditorInvalid}
          />
        )}
      </FormDialog>

      <FormDialog
        open={Boolean(runTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRunTarget(null)
            setRunError('')
          }
        }}
        title={`启动运行：${runTarget?.data.name ?? ''}`}
        description='inputs 会按 AgentScope Msg 数组传给第一步；可以留空使用 []。'
        error={runError || (start.error ? errorText(start.error) : undefined)}
        pending={start.isPending}
        formAriaLabel='启动 SOP 运行'
        submitLabel='启动运行'
        onCancel={() => setRunTarget(null)}
        onSubmit={() => start.mutate()}
      >
        <div className='space-y-2'>
          <Label htmlFor='sop-run-inputs'>启动输入 JSON</Label>
          <Textarea
            id='sop-run-inputs'
            className='min-h-44 font-mono text-xs'
            value={runInputs}
            onChange={(event) => setRunInputs(event.target.value)}
            placeholder='[]'
          />
          <p className='text-xs text-muted-foreground'>
            示例：[{`{"name":"user","role":"user","content":"请处理这份材料"}`}]
          </p>
        </div>
      </FormDialog>

      <Dialog
        open={Boolean(selectedRunId)}
        onOpenChange={(open) => !open && setSelectedRunId('')}
      >
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-3xl'>
          <DialogHeader>
            <DialogTitle>SOP 运行详情</DialogTitle>
            <DialogDescription>
              {runDetail ? `${runDetail.id} · ${statusLabel(runDetail.state?.phase)}` : '正在加载运行状态…'}
            </DialogDescription>
          </DialogHeader>
          {runDetailQuery.isLoading ? (
            <p className='py-8 text-center text-sm text-muted-foreground'>正在加载…</p>
          ) : runDetailQuery.isError ? (
            <p role='alert' className='text-sm text-destructive'>{errorText(runDetailQuery.error)}</p>
          ) : runDetail ? (
            <RunDetail
              run={runDetail}
              onVerdict={(stepIndex) => {
                setVerdictPassed(true)
                setVerdictMessage('')
                setVerdictTarget({ run: runDetail, stepIndex })
              }}
            />
          ) : null}
          <DialogFooter>
            <Button variant='outline' onClick={() => setSelectedRunId('')}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(verdictTarget)}
        onOpenChange={(open) => !open && setVerdictTarget(null)}
      >
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>提交人工 verdict</DialogTitle>
            <DialogDescription>
              这是 AgentScope `human` verifier 暂停的步骤，提交后后台会继续推进运行。
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='rounded-md border bg-muted/30 p-3 text-sm'>
              {verdictTarget &&
                (verdictTarget.run.definition.steps[verdictTarget.stepIndex]?.verifier as
                  | { question?: string }
                  | undefined)?.question}
            </div>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant={verdictPassed ? 'default' : 'outline'}
                onClick={() => setVerdictPassed(true)}
              >
                <CheckCircle2 className='mr-2 size-4' />
                通过
              </Button>
              <Button
                type='button'
                variant={!verdictPassed ? 'destructive' : 'outline'}
                onClick={() => setVerdictPassed(false)}
              >
                <XCircle className='mr-2 size-4' />
                拒绝
              </Button>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='sop-verdict-message'>说明</Label>
              <Textarea
                id='sop-verdict-message'
                value={verdictMessage}
                onChange={(event) => setVerdictMessage(event.target.value)}
                placeholder={verdictPassed ? '可选' : '请说明需要补充或修改的内容'}
              />
            </div>
            {verdict.error && (
              <p role='alert' className='text-sm text-destructive'>
                {errorText(verdict.error)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setVerdictTarget(null)}>取消</Button>
            <Button onClick={() => verdict.mutate()} disabled={verdict.isPending}>
              {verdict.isPending ? '提交中…' : '提交 verdict'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title='删除 SOP'
        desc={`将删除“${deleteTarget?.data.name ?? ''}”及其运行记录。此操作不可恢复。`}
        destructive
        confirmText='确认删除'
        isLoading={remove.isPending}
        handleConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </main>
  )
}

function MetricCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string
  value: number
  icon: React.ReactNode
  accent?: 'amber' | 'blue'
}) {
  return (
    <div className={panel}>
      <div className='flex items-center justify-between gap-3'>
        <span className='text-sm text-muted-foreground'>{label}</span>
        <span
          className={
            accent === 'amber'
              ? 'text-amber-600'
              : accent === 'blue'
                ? 'text-blue-600'
                : 'text-muted-foreground'
          }
        >
          {icon}
        </span>
      </div>
      <p className='mt-3 text-3xl font-semibold'>{value}</p>
    </div>
  )
}

function RunDetail({
  run,
  onVerdict,
}: {
  run: SopRun
  onVerdict: (stepIndex: number) => void
}) {
  const steps = run.state?.steps ?? []
  return (
    <div className='space-y-4 text-sm'>
      <dl className='grid gap-3 sm:grid-cols-3'>
        <Detail label='Run ID' value={run.id} />
        <Detail label='SOP ID' value={run.sop_id} />
        <Detail label='创建时间' value={formatDate(run.state?.created_at ?? run.created_at)} />
      </dl>
      <div className='space-y-2'>
        <h3 className='font-medium'>步骤状态</h3>
        {run.definition.steps.map((definition, index) => {
          const state = steps[index]
          const awaiting =
            state?.phase === 'awaiting' &&
            definition.verifier &&
            definition.verifier.type === 'human'
          return (
            <div key={`${definition.subject}-${index}`} className='rounded-md border p-3'>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                  <p className='font-medium'>
                    {index + 1}. {definition.subject}
                  </p>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    {definition.description}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs ${statusClass(state?.phase)}`}>
                  {statusLabel(state?.phase)}
                </span>
              </div>
              {state?.verifications?.length ? (
                <div className='mt-3 space-y-1 text-xs text-muted-foreground'>
                  {state.verifications.map((item, verificationIndex) => (
                    <p key={verificationIndex}>
                      {item.passed ? '通过' : '拒绝'} · {item.message || '无说明'} ·{' '}
                      {item.verifier || '未知审核者'}
                    </p>
                  ))}
                </div>
              ) : null}
              {awaiting && (
                <Button size='sm' className='mt-3' onClick={() => onVerdict(index)}>
                  <CircleAlert className='mr-1 size-3.5' />
                  处理人工审核
                </Button>
              )}
            </div>
          )
        })}
      </div>
      {run.sessions && Object.keys(run.sessions).length > 0 && (
        <div>
          <h3 className='mb-2 font-medium'>会话</h3>
          <div className='grid gap-2 sm:grid-cols-2'>
            {Object.entries(run.sessions).map(([key, sessionId]) => (
              <div key={key} className='rounded-md border px-3 py-2'>
                <p className='text-xs text-muted-foreground'>{key}</p>
                <p className='mt-1 break-all font-mono text-xs'>{sessionId}</p>
              </div>
            ))}
          </div>
        </div>
      )}
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
