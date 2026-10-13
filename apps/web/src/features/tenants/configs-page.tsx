import { useRef, useState } from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { Input } from '@/components/ui/input'
import { formatMessage, useLocaleText } from '@/lib/i18n'
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
  const t = useLocaleText()
  const client = useQueryClient()
  const [page, setPage] = useState(1)
  const [nameFilter, setNameFilter] = useState('')
  const [keyFilter, setKeyFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sensitiveFilter, setSensitiveFilter] = useState('')
  const [draft, setDraft] = useState<ConfigDraft | null>(null)
  const [draftTenantId, setDraftTenantId] = useState<string | null>(null)
  const [error, setError] = useState('')
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
    onSuccess: async () => { setDraft(null); setDraftTenantId(null); setError(''); await refresh() },
    onError: (cause) => setError(errorText(cause)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteTenantConfig(tenantId, id),
    onSuccess: async () => { setError(''); await refresh() },
    onError: (cause) => setError(errorText(cause)),
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
  const busy = save.isPending || remove.isPending || toggle.isPending
  const setFilter = (setter: (value: string) => void) => (value: string) => { setter(value); setPage(1) }
  return <main className="space-y-5 p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold"><LocalizedText text={"租户参数配置"} /></h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground"><LocalizedText text={"管理当前租户的运行参数。敏感值不会显示在列表或写入响应中，只会在你主动查看时单独请求。"} /></p></div><button className={primary} onClick={() => { setError(''); setDraftTenantId(tenantId); setDraft(emptyDraft()) }}><LocalizedText text={"创建参数"} /></button></header>
    {error && <ErrorBox message={error} />}
    {draft && draftTenantId === tenantId && <ConfigEditor draft={draft} pending={save.isPending} onChange={setDraft} onCancel={() => { setDraft(null); setDraftTenantId(null) }} onSave={() => save.mutate(draft)} />}
    {reveal.id && reveal.tenantId === tenantId && <section className={`${panel} space-y-3`} role="dialog" aria-modal="true" aria-label={t('查看敏感配置值')}>
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold"><LocalizedText text={"敏感配置："} />{reveal.name}</h2><p className="text-sm text-muted-foreground"><LocalizedText text={"仅本次按需读取；关闭后页面状态会清除。"} /></p></div><button className={button} onClick={closeReveal}><LocalizedText text={"关闭"} /></button></div>
      {reveal.loading ? <p className="text-sm text-muted-foreground"><LocalizedText text={"正在安全读取…"} /></p> : reveal.error ? <ErrorBox message={reveal.error} /> : <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/30 p-3 text-sm">{reveal.value ?? '（空值）'}</pre>}
    </section>}
    <section className={`${panel} space-y-4`}>
      <div><h2 className="font-semibold"><LocalizedText text={"配置列表"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText text={"按名称、键名、分组、状态和敏感级别筛选；敏感值仅显示为“未加载”。"} /></p></div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Input aria-label="按名称筛选" className={input} value={nameFilter} placeholder="配置名称" onChange={(event) => setFilter(setNameFilter)(event.target.value)} />
        <Input aria-label="按键名筛选" className={input} value={keyFilter} placeholder="配置键名" onChange={(event) => setFilter(setKeyFilter)(event.target.value)} />
        <Input aria-label="按分组筛选" className={input} value={groupFilter} placeholder="配置分组" onChange={(event) => setFilter(setGroupFilter)(event.target.value)} />
        <LocalizedNativeSelect aria-label="按状态筛选" className={input} value={statusFilter} onChange={(event) => setFilter(setStatusFilter)(event.target.value)}><option value=""><LocalizedText text={"全部状态"} /></option><option value="0"><LocalizedText text={"启用"} /></option><option value="1"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect>
        <LocalizedNativeSelect aria-label="按敏感级别筛选" className={input} value={sensitiveFilter} onChange={(event) => setFilter(setSensitiveFilter)(event.target.value)}><option value=""><LocalizedText text={"全部级别"} /></option><option value="false"><LocalizedText text={"普通"} /></option><option value="true"><LocalizedText text={"敏感"} /></option></LocalizedNativeSelect>
      </div>
      {configs.isLoading ? <p className="py-6 text-center text-sm text-muted-foreground"><LocalizedText text={"正在加载参数…"} /></p> : configs.isError ? <ErrorBox message={errorText(configs.error)} /> : rows.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3"><LocalizedText text={"配置"} /></th><th className="p-3"><LocalizedText text={"分组 / 状态"} /></th><th className="p-3"><LocalizedText text={"值"} /></th><th className="p-3"><LocalizedText text={"公开"} /></th><th className="p-3"><LocalizedText text={"更新"} /></th><th className="p-3"><LocalizedText text={"操作"} /></th></tr></thead><tbody>
        {rows.map((row) => <tr key={`${row.tenant_id}:${row.config_id}`} className="border-b align-top last:border-0">
          <td className="p-3"><span className="font-medium">{row.config_name}</span><code className="mt-1 block text-xs text-muted-foreground">{row.config_key}</code>{row.is_sensitive && <span className="mt-1 inline-block rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700"><LocalizedText text={"敏感"} /></span>}</td>
          <td className="p-3">{row.group_name || '—'}<span className="block text-muted-foreground">{row.status === '0' ? <LocalizedText text={"启用"} /> : <LocalizedText text={"停用"} />}</span></td>
          <td className="max-w-sm p-3">{row.is_sensitive || row.value_redacted ? <span className="text-muted-foreground"><LocalizedText text={"机密值（未加载）"} /></span> : <code className="line-clamp-3 whitespace-pre-wrap break-all">{row.config_value ?? ''}</code>}</td>
          <td className="p-3">{row.is_frontend && !row.is_sensitive ? <LocalizedText text={"租户成员可读"} /> : <LocalizedText text={"仅管理员"} />}</td>
          <td className="whitespace-nowrap p-3 text-xs text-muted-foreground">{new Date(row.updated_at).toLocaleString('zh-CN')}<span className="block"><LocalizedText text={"用户 "} />{row.updated_by}</span></td>
          <td className="space-x-3 whitespace-nowrap p-3">{row.is_sensitive && <button className="underline" disabled={reveal.loading} onClick={() => void revealValue(row)}><LocalizedText text={"查看敏感值"} /></button>}<button className="underline" onClick={() => { setError(''); setDraftTenantId(tenantId); setDraft(toDraft(row)) }}><LocalizedText text={"编辑"} /></button><button className="underline disabled:opacity-50" disabled={busy} onClick={() => toggle.mutate({ id: row.config_id, status: row.status === '0' ? '1' : '0' })}>{row.status === '0' ? <LocalizedText text={"停用"} /> : <LocalizedText text={"启用"} />}</button><button className="text-destructive underline disabled:opacity-50" disabled={busy} onClick={() => { if (window.confirm(formatMessage('删除参数“{name}”？', { name: row.config_name }))) remove.mutate(row.config_id) }}><LocalizedText text={"删除"} /></button></td>
        </tr>)}
      </tbody></table></div> : <p className="py-8 text-center text-sm text-muted-foreground"><LocalizedText text={"暂无参数配置"} /></p>}
      <Pager page={page} size={20} total={configs.data?.total ?? 0} setPage={setPage} />
    </section>
  </main>
}

function ConfigEditor({ draft, pending, onChange, onCancel, onSave }: {
  draft: ConfigDraft
  pending: boolean
  onChange: (draft: ConfigDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const set = <K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) => onChange({ ...draft, [key]: value })
  const updateSensitive = Boolean(draft.config_id && draft.is_sensitive)
  return <form className={`${panel} space-y-4`} onSubmit={(event) => { event.preventDefault(); onSave() }}>
    <h2 className="font-semibold">{draft.config_id ? <LocalizedText text={"编辑参数配置"} /> : <LocalizedText text={"创建参数配置"} />}</h2>
    {updateSensitive && <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><LocalizedText text={"现有机密值不会自动读取。勾选“替换敏感值”后输入新值；不勾选则仅保存其他字段。"} /></p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="space-y-1 text-sm"><span><LocalizedText text={"配置名称"} /></span><Input autoFocus required maxLength={100} className={input} value={draft.config_name} onChange={(event) => set('config_name', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"配置键名"} /></span><Input required maxLength={100} pattern="[A-Za-z][A-Za-z0-9_.-]*" className={input} value={draft.config_key} onChange={(event) => set('config_key', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"分组"} /></span><Input maxLength={100} className={input} value={draft.group_name} onChange={(event) => set('group_name', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"状态"} /></span><LocalizedNativeSelect className={input} value={draft.status} onChange={(event) => set('status', event.target.value as '0' | '1')}><option value="0"><LocalizedText text={"启用"} /></option><option value="1"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect></label>
      <label className="flex items-center gap-2 text-sm"><Input type="checkbox" checked={draft.is_sensitive} onChange={(event) => onChange({ ...draft, is_sensitive: event.target.checked, is_frontend: event.target.checked ? false : draft.is_frontend, replaceSensitiveValue: event.target.checked ? draft.replaceSensitiveValue : false })} /><span><LocalizedText text={"敏感配置"} /></span></label>
      <label className="flex items-center gap-2 text-sm"><Input type="checkbox" checked={draft.is_frontend} disabled={draft.is_sensitive} onChange={(event) => set('is_frontend', event.target.checked)} /><span><LocalizedText text={"向租户成员公开读取"} /></span></label>
    </div>
    {updateSensitive && <label className="flex items-center gap-2 text-sm"><Input type="checkbox" checked={draft.replaceSensitiveValue} onChange={(event) => set('replaceSensitiveValue', event.target.checked)} /><span><LocalizedText text={"替换敏感值"} /></span></label>}
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
    <div className="flex gap-2"><button className={primary} disabled={pending || !draft.config_name.trim() || !draft.config_key.trim()}>{pending ? <LocalizedText text={"保存中…"} /> : <LocalizedText text={"保存配置"} />}</button><button type="button" className={button} onClick={onCancel}><LocalizedText text={"取消"} /></button></div>
  </form>
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
