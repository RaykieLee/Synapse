import { useRef, useState } from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DataTableSkeletonRows,
  SortableTableHead,
  sortRows,
  type TableSortState,
} from '@/components/data-table'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getTenant } from '@/api/tenants'
import {
  createTenantConfig,
  deleteTenantConfig,
  getTenantConfig,
  listTenantConfigs,
  type TenantConfig,
  type TenantConfigPatchPayload,
  updateTenantConfig,
} from '@/api/tenant-configs'
import { ApiProblem } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { LocalizedText } from '@/components/localized-text'
import { FormDialog } from '@/components/form-dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type ConfigDraft = {
  config_id?: string
  config_name: string
  config_key: string
  config_value: string
  group_name: string
  is_frontend: boolean
  is_sensitive: boolean
  status: '0' | '1'
  remark: string
  replaceSensitiveValue: boolean
}

const panel = 'rounded-lg border bg-card p-5 shadow-sm'
const input = 'h-10 w-full rounded-md border bg-background px-3 text-sm'
const button = 'rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50'
const primary = 'rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50'

export function TenantConfigsPage() {
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId/configs' })
  const actorId = useAuthStore((state) => state.auth.user?.user_id ?? 'anonymous')
  // key 重置本地草稿、敏感值展示与请求令牌，避免跨租户串态。
  return <TenantConfigsPanel key={`${actorId}:${tenantId}`} tenantId={tenantId} actorId={actorId} />
}

function TenantConfigsPanel({ tenantId, actorId }: { tenantId: string; actorId: string }) {
  const client = useQueryClient()
  const [page, setPage] = useState(1)
  const [nameFilter, setNameFilter] = useState('')
  const [keyFilter, setKeyFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sensitiveFilter, setSensitiveFilter] = useState('')
  const [sorting, setSorting] = useState<TableSortState>(null)
  const [draft, setDraft] = useState<ConfigDraft | null>(null)
  const [draftTenantId, setDraftTenantId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<TenantConfig | null>(null)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [reveal, setReveal] = useState<{ tenantId: string; id: string; name: string; value: string | null; loading: boolean; error: string }>({ tenantId: '', id: '', name: '', value: null, loading: false, error: '' })
  const revealRequest = useRef(0)
  const tenantKey = ['synapse', actorId, tenantId, 'personal', 'tenant'] as const
  const tenant = useQuery({ queryKey: tenantKey, queryFn: () => getTenant(tenantId) })
  const canManage = tenant.data?.tenant_role === 'owner' || tenant.data?.tenant_role === 'admin'
  const tenantActive = tenant.data?.status === 'active'
  const listParams = {
    page,
    pageSize: 20,
    ...(nameFilter.trim() ? { configName: nameFilter.trim() } : {}),
    ...(keyFilter.trim() ? { configKey: keyFilter.trim() } : {}),
    ...(groupFilter.trim() ? { groupName: groupFilter.trim() } : {}),
    ...(statusFilter ? { status: statusFilter as '0' | '1' } : {}),
    ...(sensitiveFilter ? { isSensitive: sensitiveFilter === 'true' } : {}),
  }
  const listKey = ['synapse', actorId, tenantId, 'tenant', 'configs', tenant.data?.membership_version ?? 0, listParams] as const
  const configs = useQuery({
    queryKey: listKey,
    enabled: canManage && tenantActive,
    queryFn: () => listTenantConfigs(tenantId, listParams),
  })
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['synapse', actorId, tenantId, 'tenant', 'configs'] })
    await client.invalidateQueries({ queryKey: tenantKey })
  }
  const save = useMutation({
    mutationFn: (value: ConfigDraft) => {
      const { config_id, replaceSensitiveValue, ...body } = value
      if (!config_id) return createTenantConfig(tenantId, body)
      const payload: TenantConfigPatchPayload = { ...body }
      if (value.is_sensitive && !replaceSensitiveValue) delete payload.config_value
      return updateTenantConfig(tenantId, config_id, payload)
    },
    onSuccess: async () => { setDraft(null); setDraftTenantId(null); setSaveError(''); setError(''); await refresh() },
    onError: (cause) => setSaveError(errorText(cause)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteTenantConfig(tenantId, id),
    onSuccess: async () => { setRemoveTarget(null); setError(''); await refresh() },
    onError: (cause) => { setRemoveTarget(null); setError(errorText(cause)) },
  })
  const toggle = useMutation({
    mutationFn: ({ id, status }: { id: string; status: '0' | '1' }) => updateTenantConfig(tenantId, id, { status }),
    onSuccess: async () => { setError(''); await refresh() },
    onError: (cause) => setError(errorText(cause)),
  })

  const revealValue = async (row: TenantConfig) => {
    const requestId = ++revealRequest.current
    const requestedTenantId = tenantId
    setReveal({ tenantId: requestedTenantId, id: row.config_id, name: row.config_name, value: null, loading: true, error: '' })
    try {
      // Sensitive detail deliberately bypasses React Query and its query cache.
      const detail = await getTenantConfig(requestedTenantId, row.config_id)
      if (revealRequest.current !== requestId) return
      setReveal({ tenantId: requestedTenantId, id: row.config_id, name: row.config_name, value: detail.config_value, loading: false, error: '' })
    } catch (cause) {
      if (revealRequest.current !== requestId) return
      setReveal({ tenantId: requestedTenantId, id: row.config_id, name: row.config_name, value: null, loading: false, error: errorText(cause) })
    }
  }
  const closeReveal = () => {
    revealRequest.current += 1
    setReveal({ tenantId: '', id: '', name: '', value: null, loading: false, error: '' })
  }

  if (tenant.isLoading) return <main className="p-6"><LocalizedText text={"正在加载租户…"} /></main>
  if (tenant.isError) return <main className="space-y-4 p-6"><ErrorBox message={errorText(tenant.error)} /></main>
  if (!canManage) return <main className="space-y-4 p-6"><ErrorBox message="仅租户所有者或管理员可以管理参数配置。" /></main>
  if (!tenantActive) return <main className="space-y-4 p-6"><ErrorBox message="租户未启用，无法管理参数配置。" /></main>

  const rows = configs.data?.items ?? []
  const sortedRows = sortRows(rows, sorting, (row, key) => {
    switch (key) {
      case 'config':
        return row.config_name
      case 'group':
        return row.group_name
      case 'value':
        return row.is_sensitive || row.value_redacted ? null : row.config_value
      case 'public':
        return row.is_frontend && !row.is_sensitive
      case 'updated':
        return row.updated_at
      default:
        return ''
    }
  })
  const busy = save.isPending || remove.isPending || toggle.isPending
  const setFilter = (setter: (value: string) => void) => (value: string) => { setter(value); setPage(1) }
  return <main className="space-y-5 p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold"><LocalizedText text={"租户参数配置"} /></h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground"><LocalizedText text={"管理当前租户的运行参数。敏感值不会显示在列表或写入响应中，只会在你主动查看时单独请求。"} /></p></div><button className={primary} onClick={() => { setError(''); setSaveError(''); setDraftTenantId(tenantId); setDraft(emptyDraft()) }}><LocalizedText text={"创建参数"} /></button></header>
    {error && <ErrorBox message={error} />}
    {draft && draftTenantId === tenantId && <ConfigEditor draft={draft} pending={save.isPending} error={saveError} onChange={setDraft} onCancel={() => { setDraft(null); setDraftTenantId(null); setSaveError('') }} onSave={() => save.mutate(draft)} />}
    {reveal.id && reveal.tenantId === tenantId && (
      <Dialog open onOpenChange={(open) => { if (!open) closeReveal() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle><LocalizedText text={"敏感配置："} />{reveal.name}</DialogTitle>
            <DialogDescription><LocalizedText text={"仅本次按需读取；关闭后页面状态会清除。"} /></DialogDescription>
          </DialogHeader>
          {reveal.loading ? <p className="text-sm text-muted-foreground"><LocalizedText text={"正在安全读取…"} /></p> : reveal.error ? <ErrorBox message={reveal.error} /> : <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/30 p-3 text-sm">{reveal.value ?? '（空值）'}</pre>}
        </DialogContent>
      </Dialog>
    )}
    <section className={`${panel} space-y-4`}>
      <div><h2 className="font-semibold"><LocalizedText text={"配置列表"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText text={"按名称、键名、分组、状态和敏感级别筛选；敏感值仅显示为“未加载”。"} /></p></div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Input aria-label="按名称筛选" className={input} value={nameFilter} placeholder="配置名称" onChange={(event) => setFilter(setNameFilter)(event.target.value)} />
        <Input aria-label="按键名筛选" className={input} value={keyFilter} placeholder="配置键名" onChange={(event) => setFilter(setKeyFilter)(event.target.value)} />
        <Input aria-label="按分组筛选" className={input} value={groupFilter} placeholder="配置分组" onChange={(event) => setFilter(setGroupFilter)(event.target.value)} />
        <LocalizedNativeSelect aria-label="按状态筛选" className={input} value={statusFilter} onChange={(event) => setFilter(setStatusFilter)(event.target.value)}><option value=""><LocalizedText text={"全部状态"} /></option><option value="0"><LocalizedText text={"启用"} /></option><option value="1"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect>
        <LocalizedNativeSelect aria-label="按敏感级别筛选" className={input} value={sensitiveFilter} onChange={(event) => setFilter(setSensitiveFilter)(event.target.value)}><option value=""><LocalizedText text={"全部级别"} /></option><option value="false"><LocalizedText text={"普通"} /></option><option value="true"><LocalizedText text={"敏感"} /></option></LocalizedNativeSelect>
      </div>
      <div className="overflow-hidden rounded-md border">
        <div className="overflow-x-auto">
          <Table className="min-w-[58rem]">
            <TableHeader>
              <TableRow className="bg-muted/35 hover:bg-muted/35">
                <SortableTableHead label={<LocalizedText text='配置' />} sortKey='config' sorting={sorting} onSortingChange={setSorting} />
                <SortableTableHead label={<LocalizedText text='分组 / 状态' />} sortKey='group' sorting={sorting} onSortingChange={setSorting} />
                <SortableTableHead label={<LocalizedText text='值' />} sortKey='value' sorting={sorting} onSortingChange={setSorting} />
                <SortableTableHead label={<LocalizedText text='公开' />} sortKey='public' sorting={sorting} onSortingChange={setSorting} />
                <SortableTableHead label={<LocalizedText text='更新' />} sortKey='updated' sorting={sorting} onSortingChange={setSorting} />
                <TableHead><LocalizedText text='操作' /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {configs.isLoading ? (
                <DataTableSkeletonRows columnCount={6} />
              ) : configs.isError ? (
                <TableRow><TableCell colSpan={6}><ErrorBox message={errorText(configs.error)} /></TableCell></TableRow>
              ) : sortedRows.length ? (
                sortedRows.map((row) => (
                  <TableRow key={`${row.tenant_id}:${row.config_id}`}>
                    <TableCell className="whitespace-normal">
                      <span className="font-medium">{row.config_name}</span>
                      <code className="mt-1 block text-xs text-muted-foreground">{row.config_key}</code>
                      {row.is_sensitive && <span className="mt-1 inline-block rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700"><LocalizedText text='敏感' /></span>}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {row.group_name || '—'}
                      <span className="block text-muted-foreground">{row.status === '0' ? <LocalizedText text='启用' /> : <LocalizedText text='停用' />}</span>
                    </TableCell>
                    <TableCell className="max-w-sm whitespace-normal">
                      {row.is_sensitive || row.value_redacted ? <span className="text-muted-foreground"><LocalizedText text='机密值（未加载）' /></span> : <code className="line-clamp-3 break-all">{row.config_value ?? ''}</code>}
                    </TableCell>
                    <TableCell>{row.is_frontend && !row.is_sensitive ? <LocalizedText text='租户成员可读' /> : <LocalizedText text='仅管理员' />}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(row.updated_at).toLocaleString('zh-CN')}
                      <span className="block"><LocalizedText text='用户 ' />{row.updated_by}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 whitespace-nowrap">
                        {row.is_sensitive && <button className="underline" disabled={reveal.loading} onClick={() => void revealValue(row)}><LocalizedText text='查看敏感值' /></button>}
                        <button className="underline" onClick={() => { setError(''); setSaveError(''); setDraftTenantId(tenantId); setDraft(toDraft(row)) }}><LocalizedText text='编辑' /></button>
                        <button className="underline disabled:opacity-50" disabled={busy} onClick={() => toggle.mutate({ id: row.config_id, status: row.status === '0' ? '1' : '0' })}>{row.status === '0' ? <LocalizedText text='停用' /> : <LocalizedText text='启用' />}</button>
                        <button className="text-destructive underline disabled:opacity-50" disabled={busy} onClick={() => setRemoveTarget(row)}><LocalizedText text='删除' /></button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground"><LocalizedText text='暂无参数配置' /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <Pager page={page} size={20} total={configs.data?.total ?? 0} setPage={setPage} />
    </section>
    <ConfirmDialog
      open={Boolean(removeTarget)}
      onOpenChange={(open) => { if (!open && !remove.isPending) setRemoveTarget(null) }}
      title="删除参数"
      desc="删除后不能恢复；被其他业务引用时服务端可能拒绝删除。"
      confirmText="确认删除"
      destructive
      isLoading={remove.isPending}
      handleConfirm={() => { if (removeTarget) remove.mutate(removeTarget.config_id) }}
    >
      {removeTarget && <div className='text-sm'><p className='font-medium'>{removeTarget.config_name}</p><code className='text-xs text-muted-foreground'>{removeTarget.config_key}</code></div>}
    </ConfirmDialog>
  </main>
}

function ConfigEditor({ draft, pending, error, onChange, onCancel, onSave }: {
  draft: ConfigDraft
  pending: boolean
  error: string
  onChange: (draft: ConfigDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const set = <K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) => onChange({ ...draft, [key]: value })
  const updateSensitive = Boolean(draft.config_id && draft.is_sensitive)
  return <FormDialog
    open
    onOpenChange={(open) => { if (!open) onCancel() }}
    title={draft.config_id ? <LocalizedText text={"编辑参数配置"} /> : <LocalizedText text={"创建参数配置"} />}
    formAriaLabel={draft.config_id ? '编辑参数配置' : '创建参数配置'}
    description="配置租户运行参数、公开读取范围和敏感级别。"
    error={error}
    submitLabel={draft.config_id ? <LocalizedText text={"保存配置"} /> : <LocalizedText text={"创建参数"} />}
    pending={pending}
    disabled={!draft.config_name.trim() || !draft.config_key.trim()}
    onSubmit={onSave}
    onCancel={onCancel}
  >
    {updateSensitive && <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><LocalizedText text={"现有机密值不会自动读取。勾选“替换敏感值”后输入新值；不勾选则仅保存其他字段。"} /></p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="space-y-1 text-sm"><span><LocalizedText text={"配置名称"} /></span><Input autoFocus required maxLength={100} className={input} value={draft.config_name} onChange={(event) => set('config_name', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"配置键名"} /></span><Input required maxLength={100} pattern="[A-Za-z][A-Za-z0-9_.-]*" className={input} value={draft.config_key} onChange={(event) => set('config_key', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"分组"} /></span><Input maxLength={100} className={input} value={draft.group_name} onChange={(event) => set('group_name', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"状态"} /></span><LocalizedNativeSelect className={input} value={draft.status} onChange={(event) => set('status', event.target.value as '0' | '1')}><option value="0"><LocalizedText text={"启用"} /></option><option value="1"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect></label>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.is_sensitive} onCheckedChange={(value) => onChange({ ...draft, is_sensitive: value === true, is_frontend: value === true ? false : draft.is_frontend, replaceSensitiveValue: value === true ? draft.replaceSensitiveValue : false })} /><span><LocalizedText text={"敏感配置"} /></span></label>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.is_frontend} disabled={draft.is_sensitive} onCheckedChange={(value) => set('is_frontend', value === true)} /><span><LocalizedText text={"向租户成员公开读取"} /></span></label>
    </div>
    {updateSensitive && <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.replaceSensitiveValue} onCheckedChange={(value) => set('replaceSensitiveValue', value === true)} /><span><LocalizedText text={"替换敏感值"} /></span></label>}
    <label className="block space-y-1 text-sm"><span><LocalizedText text={"配置值"} />{updateSensitive && !draft.replaceSensitiveValue ? <LocalizedText text={"（保留现值）"} /> : <LocalizedText text={""} />}</span><textarea
      rows={4}
      maxLength={10000}
      required={!draft.config_id || (updateSensitive && draft.replaceSensitiveValue)}
      disabled={updateSensitive && !draft.replaceSensitiveValue}
      autoComplete="new-password"
      className="w-full rounded-md border bg-background p-3 font-mono text-sm disabled:opacity-60"
      value={draft.config_value}
      placeholder={updateSensitive && !draft.replaceSensitiveValue ? '未读取现有值；勾选替换后输入新值' : draft.is_sensitive ? '敏感内容仅会发送给此租户的管理接口' : ''}
      onChange={(event) => set('config_value', event.target.value)}
    /></label>
    <label className="block space-y-1 text-sm"><span><LocalizedText text={"备注"} /></span><textarea maxLength={500} rows={2} className="w-full rounded-md border bg-background p-3" value={draft.remark} onChange={(event) => set('remark', event.target.value)} /></label>
  </FormDialog>
}

function emptyDraft(): ConfigDraft { return { config_name: '', config_key: '', config_value: '', group_name: '', is_frontend: false, is_sensitive: false, status: '0', remark: '', replaceSensitiveValue: true } }
function toDraft(row: TenantConfig): ConfigDraft { return { config_id: row.config_id, config_name: row.config_name, config_key: row.config_key, config_value: row.is_sensitive ? '' : row.config_value ?? '', group_name: row.group_name, is_frontend: row.is_frontend, is_sensitive: row.is_sensitive, status: row.status, remark: row.remark ?? '', replaceSensitiveValue: false } }
function Pager({ page, size, total, setPage }: { page: number; size: number; total: number; setPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size))
  return <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground"><LocalizedText text={"共 "} />{total} <LocalizedText text={" 条"} /></span><div className="flex items-center gap-2"><button className={button} disabled={page <= 1} onClick={() => setPage(page - 1)}><LocalizedText text={"上一页"} /></button><span>{page} <LocalizedText text={" / "} />{pages}</span><button className={button} disabled={page >= pages} onClick={() => setPage(page + 1)}><LocalizedText text={"下一页"} /></button></div></div>
}
function ErrorBox({ message }: { message: string }) { return <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{message}</div> }
function errorText(error: unknown) {
  if (error instanceof ApiProblem) {
    const known: Record<string, string> = {
      CONFIG_KEY_CONFLICT: '该租户已存在相同配置键名。',
      SENSITIVE_CONFIG_CANNOT_BE_FRONTEND: '敏感配置不能向租户成员公开读取。',
      FORBIDDEN: '仅租户所有者或管理员可以管理参数配置。',
      MEMBERSHIP_INACTIVE: '当前账号已不属于此租户。',
      RESOURCE_NOT_FOUND: '配置不存在，或不属于当前租户。',
    }
    return known[error.code ?? ''] ?? `${error.message}${error.code ? `（${error.code}）` : ''}`
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}
