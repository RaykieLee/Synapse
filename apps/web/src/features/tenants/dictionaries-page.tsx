import { useState } from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { Input } from '@/components/ui/input'
import { formatMessage } from '@/lib/i18n'
import { Link, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getTenant, type Page } from '@/api/tenants'
import { ApiProblem, api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { LocalizedText } from '@/components/localized-text'

type DictType = { dict_type_id: string; tenant_id: string; dict_name: string; dict_type: string; order_num: number; status: '0' | '1'; remark: string | null }
type DictEntry = { dict_data_id: string; tenant_id: string; dict_type_id: string; dict_type: string; dict_sort: number; dict_label: string; dict_value: string; css_class: string | null; list_class: string | null; is_default: 'Y' | 'N'; status: '0' | '1'; remark: string | null }
type TypeDraft = { dict_type_id?: string; dict_name: string; dict_type: string; order_num: number; status: '0' | '1'; remark: string }
type EntryDraft = { dict_data_id?: string; dict_sort: number; dict_label: string; dict_value: string; css_class: string; list_class: string; is_default: 'Y' | 'N'; status: '0' | '1'; remark: string }

const panel = 'rounded-lg border bg-card p-5 shadow-sm'
const input = 'h-10 w-full rounded-md border bg-background px-3 text-sm'
const button = 'rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50'
const primary = 'rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50'

export function TenantDictionariesPage() {
  const actor = useAuthStore((state) => state.auth.user)
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId/dictionaries' })
  const client = useQueryClient()
  const [typeSearch, setTypeSearch] = useState('')
  const [typeSearchField, setTypeSearchField] = useState<'dict_name' | 'dict_type'>('dict_name')
  const [typeStatus, setTypeStatus] = useState('')
  const [typePage, setTypePage] = useState(1)
  const [entrySearch, setEntrySearch] = useState('')
  const [entryStatus, setEntryStatus] = useState('')
  const [entryPage, setEntryPage] = useState(1)
  const [selectedTypeId, setSelectedTypeId] = useState('')
  const [typeDraft, setTypeDraft] = useState<TypeDraft | null>(null)
  const [entryDraft, setEntryDraft] = useState<EntryDraft | null>(null)
  const [error, setError] = useState('')

  const tenantKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'personal', 'tenant'] as const
  const tenant = useQuery({ queryKey: tenantKey, queryFn: () => getTenant(tenantId) })
  const canManage = tenant.data?.tenant_role === 'owner' || tenant.data?.tenant_role === 'admin'
  const tenantActive = tenant.data?.status === 'active'
  const normalizedTypeSearch = typeSearch.trim()
  const typeParams = new URLSearchParams({ page: String(typePage), page_size: '20' })
  if (normalizedTypeSearch) typeParams.set(typeSearchField, normalizedTypeSearch)
  if (typeStatus) typeParams.set('status', typeStatus)
  const typesKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'tenant', 'dictionaries', 'types', tenant.data?.membership_version ?? 0, typePage, typeParams.toString()] as const
  const types = useQuery({
    queryKey: typesKey,
    enabled: canManage && tenantActive,
    queryFn: () => api<Page<DictType>>(`/tenants/${tenantId}/dict/types?${typeParams}`),
  })
  const selectedTypeKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'tenant', 'dictionaries', 'type', selectedTypeId] as const
  const selectedType = useQuery({
    queryKey: selectedTypeKey,
    enabled: canManage && tenantActive && Boolean(selectedTypeId),
    queryFn: () => api<DictType>(`/tenants/${tenantId}/dict/types/${selectedTypeId}`),
  })
  const normalizedEntrySearch = entrySearch.trim()
  const entryParams = new URLSearchParams({ page: String(entryPage), page_size: '20' })
  if (normalizedEntrySearch) entryParams.set('dict_label', normalizedEntrySearch)
  if (entryStatus) entryParams.set('status', entryStatus)
  const entriesKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'tenant', 'dictionaries', 'data', selectedTypeId, tenant.data?.membership_version ?? 0, entryPage, entryParams.toString()] as const
  const entries = useQuery({
    queryKey: entriesKey,
    enabled: canManage && tenantActive && Boolean(selectedTypeId) && !selectedType.isError,
    queryFn: () => api<Page<DictEntry>>(`/tenants/${tenantId}/dict/types/${selectedTypeId}/data?${entryParams}`),
  })

  const invalidateTypes = async () => {
    await client.invalidateQueries({ queryKey: ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'tenant', 'dictionaries', 'types'] })
    await client.invalidateQueries({ queryKey: ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'tenant', 'dictionaries', 'type'] })
  }
  const invalidateEntries = async () => {
    await client.invalidateQueries({ queryKey: ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'tenant', 'dictionaries', 'data', selectedTypeId] })
  }
  const saveType = useMutation({
    mutationFn: (value: TypeDraft) => {
      const { dict_type_id, ...body } = value
      return dict_type_id
        ? api<DictType>(`/tenants/${tenantId}/dict/types/${dict_type_id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api<DictType>(`/tenants/${tenantId}/dict/types`, { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: async (row) => { setError(''); setTypeDraft(null); setSelectedTypeId(row.dict_type_id); await invalidateTypes() },
    onError: (cause) => setError(errorText(cause)),
  })
  const deleteType = useMutation({
    mutationFn: (id: string) => api<void>(`/tenants/${tenantId}/dict/types/${id}`, { method: 'DELETE' }),
    onSuccess: async (_result, id) => { setError(''); if (selectedTypeId === id) setSelectedTypeId(''); await invalidateTypes() },
    onError: (cause) => setError(errorText(cause)),
  })
  const saveEntry = useMutation({
    mutationFn: (value: EntryDraft) => {
      const { dict_data_id, ...body } = value
      const path = `/tenants/${tenantId}/dict/types/${selectedTypeId}/data`
      return dict_data_id
        ? api<DictEntry>(`${path}/${dict_data_id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api<DictEntry>(path, { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: async () => { setError(''); setEntryDraft(null); await invalidateEntries() },
    onError: (cause) => setError(errorText(cause)),
  })
  const deleteEntry = useMutation({
    mutationFn: (id: string) => api<void>(`/tenants/${tenantId}/dict/types/${selectedTypeId}/data/${id}`, { method: 'DELETE' }),
    onSuccess: async () => { setError(''); await invalidateEntries() },
    onError: (cause) => setError(errorText(cause)),
  })
  const reorderType = useMutation({
    mutationFn: async ({ id, delta }: { id: string; delta: -1 | 1 }) => {
      const all = await allPages<DictType>(`/tenants/${tenantId}/dict/types`)
      const index = all.findIndex((row) => row.dict_type_id === id)
      const next = index + delta
      if (index < 0 || next < 0 || next >= all.length) return
      ;[all[index], all[next]] = [all[next], all[index]]
      return api<{ updated: number }>(`/tenants/${tenantId}/dict/types/reorder`, {
        method: 'POST', body: JSON.stringify({ items: all.map((row, order) => ({ dict_type_id: row.dict_type_id, order_num: (order + 1) * 10 })) }),
      })
    },
    onSuccess: async () => { setError(''); await invalidateTypes() },
    onError: (cause) => setError(errorText(cause)),
  })
  const reorderEntry = useMutation({
    mutationFn: async ({ id, delta }: { id: string; delta: -1 | 1 }) => {
      const path = `/tenants/${tenantId}/dict/types/${selectedTypeId}/data`
      const all = await allPages<DictEntry>(path)
      const index = all.findIndex((row) => row.dict_data_id === id)
      const next = index + delta
      if (index < 0 || next < 0 || next >= all.length) return
      ;[all[index], all[next]] = [all[next], all[index]]
      return api<{ updated: number }>(`${path}/reorder`, {
        method: 'POST', body: JSON.stringify({ items: all.map((row, order) => ({ dict_data_id: row.dict_data_id, dict_sort: (order + 1) * 10 })) }),
      })
    },
    onSuccess: async () => { setError(''); await invalidateEntries() },
    onError: (cause) => setError(errorText(cause)),
  })

  if (tenant.isLoading) return <main className="p-6"><LocalizedText text={"正在加载租户…"} /></main>
  if (tenant.isError) return <main className="space-y-4 p-6"><Link className="underline" to="/tenants"><LocalizedText text={"返回租户列表"} /></Link><ErrorBox message={errorText(tenant.error)} /></main>
  if (!canManage) return <main className="space-y-4 p-6"><Link className="underline" to="/tenants/$tenantId" params={{ tenantId }}><LocalizedText text={"返回租户"} /></Link><ErrorBox message="仅租户所有者或管理员可以管理字典。" /></main>
  if (!tenantActive) return <main className="space-y-4 p-6"><Link className="underline" to="/tenants/$tenantId" params={{ tenantId }}><LocalizedText text={"返回租户"} /></Link><ErrorBox message="租户未启用，无法管理字典。" /></main>

  const typesItems = types.data?.items ?? []
  const typeBusy = saveType.isPending || deleteType.isPending || reorderType.isPending
  const entryBusy = saveEntry.isPending || deleteEntry.isPending || reorderEntry.isPending
  return <main className="space-y-5 p-6">
    <Link className="text-sm underline" to="/tenants/$tenantId" params={{ tenantId }}><LocalizedText text={"← 返回 "} />{tenant.data?.name}</Link>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold"><LocalizedText text={"租户字典"} /></h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground"><LocalizedText text={"管理当前租户的字典类型和条目。每个租户可独立使用相同类型标识。"} /></p></div>
      <button className={primary} onClick={() => { setError(''); setTypeDraft(emptyTypeDraft()) }}><LocalizedText text={"创建字典类型"} /></button></header>
    {error && <ErrorBox message={error} />}
    {typeDraft && <TypeEditor draft={typeDraft} pending={saveType.isPending} onChange={setTypeDraft} onCancel={() => setTypeDraft(null)} onSave={() => saveType.mutate(typeDraft)} />}
    <section className={`${panel} space-y-4`}>
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold"><LocalizedText text={"字典类型"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText text={"可按名称或标识筛选；上移/下移会重排当前租户全部类型。"} /></p></div><div className="flex flex-wrap gap-2"><LocalizedNativeSelect aria-label="类型搜索字段" className={`${input} max-w-36`} value={typeSearchField} onChange={(event) => { setTypeSearchField(event.target.value as 'dict_name' | 'dict_type'); setTypePage(1) }}><option value="dict_name"><LocalizedText text={"名称"} /></option><option value="dict_type"><LocalizedText text={"标识"} /></option></LocalizedNativeSelect><Input aria-label="搜索字典类型" className={`${input} max-w-64`} value={typeSearch} placeholder={typeSearchField === 'dict_name' ? "按名称筛选" : "按标识筛选"} onChange={(event) => { setTypeSearch(event.target.value); setTypePage(1) }} /><LocalizedNativeSelect aria-label="类型状态筛选" className={`${input} max-w-40`} value={typeStatus} onChange={(event) => { setTypeStatus(event.target.value); setTypePage(1) }}><option value=""><LocalizedText text={"全部状态"} /></option><option value="0"><LocalizedText text={"启用"} /></option><option value="1"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect></div></div>
      {types.isLoading ? <p className="text-sm text-muted-foreground"><LocalizedText text={"正在加载字典类型…"} /></p> : types.isError ? <ErrorBox message={errorText(types.error)} /> : typesItems.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3"><LocalizedText text={"名称"} /></th><th className="p-3"><LocalizedText text={"类型标识"} /></th><th className="p-3"><LocalizedText text={"排序"} /></th><th className="p-3"><LocalizedText text={"状态"} /></th><th className="p-3"><LocalizedText text={"操作"} /></th></tr></thead><tbody>{typesItems.map((row) => <tr className={`border-b last:border-0 ${selectedTypeId === row.dict_type_id ? 'bg-muted/40' : ''}`} key={row.dict_type_id}><td className="p-3 font-medium">{row.dict_name}</td><td className="p-3"><code>{row.dict_type}</code></td><td className="p-3">{row.order_num}</td><td className="p-3">{row.status === '0' ? <LocalizedText text={"启用"} /> : <LocalizedText text={"停用"} />}</td><td className="space-x-3 p-3"><button className="underline" onClick={() => { setSelectedTypeId(row.dict_type_id); setEntryPage(1); setEntrySearch(''); setEntryStatus(''); setEntryDraft(null); setError('') }}><LocalizedText text={"管理条目"} /></button><button className="underline disabled:opacity-50" disabled={typeBusy} onClick={() => reorderType.mutate({ id: row.dict_type_id, delta: -1 })}><LocalizedText text={"上移"} /></button><button className="underline disabled:opacity-50" disabled={typeBusy} onClick={() => reorderType.mutate({ id: row.dict_type_id, delta: 1 })}><LocalizedText text={"下移"} /></button><button className="underline" onClick={() => { setError(''); setTypeDraft(toTypeDraft(row)) }}><LocalizedText text={"编辑"} /></button><button className="underline disabled:opacity-50" disabled={typeBusy} onClick={() => saveType.mutate({ ...toTypeDraft(row), status: row.status === '0' ? '1' : '0' })}>{row.status === '0' ? <LocalizedText text={"停用"} /> : <LocalizedText text={"启用"} />}</button><button className="text-destructive underline disabled:opacity-50" disabled={typeBusy} onClick={() => { if (window.confirm(formatMessage('删除字典类型“{name}”？类型下必须没有条目。', { name: row.dict_name }))) deleteType.mutate(row.dict_type_id) }}><LocalizedText text={"删除"} /></button></td></tr>)}</tbody></table></div> : <p className="py-6 text-center text-sm text-muted-foreground"><LocalizedText text={"暂无字典类型"} /></p>}
      <Pager page={typePage} size={20} total={types.data?.total ?? 0} setPage={setTypePage} />
    </section>
    {selectedTypeId && <section className={`${panel} space-y-4`}>
      {selectedType.isLoading ? <p className="text-sm text-muted-foreground"><LocalizedText text={"正在加载类型…"} /></p> : selectedType.isError ? <ErrorBox message={errorText(selectedType.error)} /> : <>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold"><LocalizedText text={"字典条目："} />{selectedType.data?.dict_name}</h2><p className="text-sm text-muted-foreground"><code>{selectedType.data?.dict_type}</code> <LocalizedText text={" · 类型状态："} />{selectedType.data?.status === '0' ? <LocalizedText text={"启用"} /> : <LocalizedText text={"停用"} />}</p></div><button className={primary} onClick={() => { setError(''); setEntryDraft(emptyEntryDraft()) }}><LocalizedText text={"创建条目"} /></button></div>
        {entryDraft && <EntryEditor draft={entryDraft} pending={saveEntry.isPending} onChange={setEntryDraft} onCancel={() => setEntryDraft(null)} onSave={() => saveEntry.mutate(entryDraft)} />}
        <div className="flex flex-wrap gap-2"><Input aria-label="搜索字典条目" className={`${input} max-w-64`} value={entrySearch} placeholder="按标签搜索" onChange={(event) => { setEntrySearch(event.target.value); setEntryPage(1) }} /><LocalizedNativeSelect aria-label="条目状态筛选" className={`${input} max-w-40`} value={entryStatus} onChange={(event) => { setEntryStatus(event.target.value); setEntryPage(1) }}><option value=""><LocalizedText text={"全部状态"} /></option><option value="0"><LocalizedText text={"启用"} /></option><option value="1"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect></div>
        {entries.isLoading ? <p className="text-sm text-muted-foreground"><LocalizedText text={"正在加载条目…"} /></p> : entries.isError ? <ErrorBox message={errorText(entries.error)} /> : entries.data?.items.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3"><LocalizedText text={"标签"} /></th><th className="p-3"><LocalizedText text={"键值"} /></th><th className="p-3"><LocalizedText text={"排序"} /></th><th className="p-3"><LocalizedText text={"默认"} /></th><th className="p-3"><LocalizedText text={"状态"} /></th><th className="p-3"><LocalizedText text={"操作"} /></th></tr></thead><tbody>{entries.data.items.map((row) => <tr key={row.dict_data_id} className="border-b last:border-0"><td className="p-3">{row.dict_label}</td><td className="p-3"><code>{row.dict_value}</code></td><td className="p-3">{row.dict_sort}</td><td className="p-3">{row.is_default === 'Y' ? <LocalizedText text={"是"} /> : <LocalizedText text={"否"} />}</td><td className="p-3">{row.status === '0' ? <LocalizedText text={"启用"} /> : <LocalizedText text={"停用"} />}</td><td className="space-x-3 p-3"><button className="underline disabled:opacity-50" disabled={entryBusy} onClick={() => reorderEntry.mutate({ id: row.dict_data_id, delta: -1 })}><LocalizedText text={"上移"} /></button><button className="underline disabled:opacity-50" disabled={entryBusy} onClick={() => reorderEntry.mutate({ id: row.dict_data_id, delta: 1 })}><LocalizedText text={"下移"} /></button><button className="underline" onClick={() => { setError(''); setEntryDraft(toEntryDraft(row)) }}><LocalizedText text={"编辑"} /></button><button className="underline disabled:opacity-50" disabled={entryBusy} onClick={() => saveEntry.mutate({ ...toEntryDraft(row), status: row.status === '0' ? '1' : '0' })}>{row.status === '0' ? <LocalizedText text={"停用"} /> : <LocalizedText text={"启用"} />}</button><button className="text-destructive underline disabled:opacity-50" disabled={entryBusy} onClick={() => { if (window.confirm(formatMessage('删除字典条目“{name}”？', { name: row.dict_label }))) deleteEntry.mutate(row.dict_data_id) }}><LocalizedText text={"删除"} /></button></td></tr>)}</tbody></table></div> : <p className="py-6 text-center text-sm text-muted-foreground"><LocalizedText text={"暂无字典条目"} /></p>}
        <Pager page={entryPage} size={20} total={entries.data?.total ?? 0} setPage={setEntryPage} />
      </>}
    </section>}
  </main>
}

function TypeEditor({ draft, pending, onChange, onCancel, onSave }: { draft: TypeDraft; pending: boolean; onChange: (draft: TypeDraft) => void; onCancel: () => void; onSave: () => void }) {
  const set = <K extends keyof TypeDraft>(key: K, value: TypeDraft[K]) => onChange({ ...draft, [key]: value })
  return <form className={`${panel} grid gap-3 sm:grid-cols-2`} onSubmit={(event) => { event.preventDefault(); onSave() }}>
    <h2 className="sm:col-span-2 font-semibold">{draft.dict_type_id ? <LocalizedText text={"编辑字典类型"} /> : <LocalizedText text={"创建字典类型"} />}</h2>
    <label className="space-y-1 text-sm"><span><LocalizedText text={"类型名称"} /></span><Input required maxLength={100} className={input} value={draft.dict_name} onChange={(event) => set('dict_name', event.target.value)} /></label>
    <label className="space-y-1 text-sm"><span><LocalizedText text={"类型标识"} /></span><Input required maxLength={100} pattern="[A-Za-z][A-Za-z0-9_.-]*" className={input} value={draft.dict_type} onChange={(event) => set('dict_type', event.target.value)} /></label>
    <label className="space-y-1 text-sm"><span><LocalizedText text={"排序"} /></span><Input type="number" min={0} className={input} value={draft.order_num} onChange={(event) => set('order_num', Number(event.target.value))} /></label>
    <label className="space-y-1 text-sm"><span><LocalizedText text={"状态"} /></span><LocalizedNativeSelect className={input} value={draft.status} onChange={(event) => set('status', event.target.value as '0' | '1')}><option value="0"><LocalizedText text={"启用"} /></option><option value="1"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect></label>
    <label className="space-y-1 text-sm sm:col-span-2"><span><LocalizedText text={"备注"} /></span><textarea maxLength={500} rows={2} className="w-full rounded-md border bg-background p-3" value={draft.remark} onChange={(event) => set('remark', event.target.value)} /></label>
    <div className="flex gap-2 sm:col-span-2"><button className={primary} disabled={pending || !draft.dict_name.trim() || !draft.dict_type.trim()}>{pending ? <LocalizedText text={"保存中…"} /> : <LocalizedText text={"保存类型"} />}</button><button type="button" className={button} onClick={onCancel}><LocalizedText text={"取消"} /></button></div>
  </form>
}

function EntryEditor({ draft, pending, onChange, onCancel, onSave }: { draft: EntryDraft; pending: boolean; onChange: (draft: EntryDraft) => void; onCancel: () => void; onSave: () => void }) {
  const set = <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) => onChange({ ...draft, [key]: value })
  return <form className={`${panel} grid gap-3 sm:grid-cols-2 lg:grid-cols-3`} onSubmit={(event) => { event.preventDefault(); onSave() }}>
    <h3 className="font-semibold sm:col-span-2 lg:col-span-3">{draft.dict_data_id ? <LocalizedText text={"编辑字典条目"} /> : <LocalizedText text={"创建字典条目"} />}</h3>
    <label className="space-y-1 text-sm"><span><LocalizedText text={"标签"} /></span><Input required maxLength={100} className={input} value={draft.dict_label} onChange={(event) => set('dict_label', event.target.value)} /></label>
    <label className="space-y-1 text-sm"><span><LocalizedText text={"键值"} /></span><Input required maxLength={100} className={input} value={draft.dict_value} onChange={(event) => set('dict_value', event.target.value)} /></label>
    <label className="space-y-1 text-sm"><span><LocalizedText text={"排序"} /></span><Input type="number" min={0} className={input} value={draft.dict_sort} onChange={(event) => set('dict_sort', Number(event.target.value))} /></label>
    <label className="space-y-1 text-sm"><span><LocalizedText text={"默认值"} /></span><LocalizedNativeSelect className={input} value={draft.is_default} onChange={(event) => set('is_default', event.target.value as 'Y' | 'N')}><option value="N"><LocalizedText text={"否"} /></option><option value="Y"><LocalizedText text={"是"} /></option></LocalizedNativeSelect></label>
    <label className="space-y-1 text-sm"><span><LocalizedText text={"状态"} /></span><LocalizedNativeSelect className={input} value={draft.status} onChange={(event) => set('status', event.target.value as '0' | '1')}><option value="0"><LocalizedText text={"启用"} /></option><option value="1"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect></label>
    <label className="space-y-1 text-sm"><span><LocalizedText text={"CSS 样式"} /></span><Input maxLength={100} className={input} value={draft.css_class} onChange={(event) => set('css_class', event.target.value)} /></label>
    <label className="space-y-1 text-sm"><span><LocalizedText text={"列表样式"} /></span><Input maxLength={100} className={input} value={draft.list_class} onChange={(event) => set('list_class', event.target.value)} /></label>
    <label className="space-y-1 text-sm sm:col-span-2 lg:col-span-3"><span><LocalizedText text={"备注"} /></span><textarea maxLength={500} rows={2} className="w-full rounded-md border bg-background p-3" value={draft.remark} onChange={(event) => set('remark', event.target.value)} /></label>
    <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><button className={primary} disabled={pending || !draft.dict_label.trim() || !draft.dict_value.trim()}>{pending ? <LocalizedText text={"保存中…"} /> : <LocalizedText text={"保存条目"} />}</button><button type="button" className={button} onClick={onCancel}><LocalizedText text={"取消"} /></button></div>
  </form>
}

function emptyTypeDraft(): TypeDraft { return { dict_name: '', dict_type: '', order_num: 0, status: '0', remark: '' } }
function toTypeDraft(row: DictType): TypeDraft { return { dict_type_id: row.dict_type_id, dict_name: row.dict_name, dict_type: row.dict_type, order_num: row.order_num, status: row.status, remark: row.remark ?? '' } }
function emptyEntryDraft(): EntryDraft { return { dict_sort: 0, dict_label: '', dict_value: '', css_class: '', list_class: '', is_default: 'N', status: '0', remark: '' } }
function toEntryDraft(row: DictEntry): EntryDraft { return { dict_data_id: row.dict_data_id, dict_sort: row.dict_sort, dict_label: row.dict_label, dict_value: row.dict_value, css_class: row.css_class ?? '', list_class: row.list_class ?? '', is_default: row.is_default, status: row.status, remark: row.remark ?? '' } }

async function allPages<T>(path: string): Promise<T[]> {
  const first = await api<Page<T>>(`${path}?page=1&page_size=100`)
  const pages = Math.ceil(first.total / first.page_size)
  if (pages <= 1) return first.items
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) => api<Page<T>>(`${path}?page=${index + 2}&page_size=100`)))
  return [...first.items, ...rest.flatMap((page) => page.items)]
}

function Pager({ page, size, total, setPage }: { page: number; size: number; total: number; setPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size))
  return <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground"><LocalizedText text={"共 "} />{total} <LocalizedText text={" 条"} /></span><div className="flex items-center gap-2"><button className={button} disabled={page <= 1} onClick={() => setPage(page - 1)}><LocalizedText text={"上一页"} /></button><span>{page} <LocalizedText text={" / "} />{pages}</span><button className={button} disabled={page >= pages} onClick={() => setPage(page + 1)}><LocalizedText text={"下一页"} /></button></div></div>
}

function ErrorBox({ message }: { message: string }) { return <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{message}</div> }
function errorText(error: unknown) {
  if (error instanceof ApiProblem) {
    const known: Record<string, string> = {
      DICT_TYPE_CONFLICT: '该租户已存在相同名称或类型标识的字典类型。',
      DICT_VALUE_CONFLICT: '此字典类型中已存在相同键值。',
      DICT_TYPE_HAS_DATA: '请先删除该字典类型下的所有条目。',
      DICT_TYPE_REORDER_SET_MISMATCH: '字典类型列表已变化，请刷新后重试排序。',
      DICT_REORDER_SET_MISMATCH: '字典条目列表已变化，请刷新后重试排序。',
      FORBIDDEN: '仅租户所有者或管理员可以管理字典。',
      MEMBERSHIP_INACTIVE: '当前账号已不属于此租户。',
      RESOURCE_NOT_FOUND: '租户或字典资源不存在，或当前账号无权查看。',
    }
    return known[error.code ?? ''] ?? `${error.message}${error.code ? `（${error.code}）` : ''}`
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}
