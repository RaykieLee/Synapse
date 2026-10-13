import { useState } from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { Input } from '@/components/ui/input'
import { useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getTenant, type Page } from '@/api/tenants'
import { ApiProblem, api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { LocalizedText } from '@/components/localized-text'
import { FormDialog } from '@/components/form-dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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

type DictType = { dict_type_id: string; tenant_id: string; dict_name: string; dict_type: string; order_num: number; status: '0' | '1'; remark: string | null }
type DictEntry = { dict_data_id: string; tenant_id: string; dict_type_id: string; dict_type: string; dict_sort: number; dict_label: string; dict_value: string; css_class: string | null; list_class: string | null; is_default: 'Y' | 'N'; status: '0' | '1'; remark: string | null }
type TypeDraft = { dict_type_id?: string; dict_name: string; dict_type: string; order_num: number; status: '0' | '1'; remark: string }
type EntryDraft = { dict_data_id?: string; dict_sort: number; dict_label: string; dict_value: string; css_class: string; list_class: string; is_default: 'Y' | 'N'; status: '0' | '1'; remark: string }
type DeleteTarget = { kind: 'type'; row: DictType } | { kind: 'entry'; row: DictEntry }

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
  const [typeSorting, setTypeSorting] = useState<TableSortState>(null)
  const [entrySearch, setEntrySearch] = useState('')
  const [entryStatus, setEntryStatus] = useState('')
  const [entryPage, setEntryPage] = useState(1)
  const [entrySorting, setEntrySorting] = useState<TableSortState>(null)
  const [selectedTypeId, setSelectedTypeId] = useState('')
  const [typeDraft, setTypeDraft] = useState<TypeDraft | null>(null)
  const [entryDraft, setEntryDraft] = useState<EntryDraft | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [error, setError] = useState('')
  const [typeError, setTypeError] = useState('')
  const [entryError, setEntryError] = useState('')

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
    onSuccess: async (row, value) => {
      setError('')
      setTypeError('')
      setTypeDraft(null)
      if (!value.dict_type_id) setSelectedTypeId(row.dict_type_id)
      await invalidateTypes()
    },
    onError: (cause) => setTypeError(errorText(cause)),
  })
  const deleteType = useMutation({
    mutationFn: (id: string) => api<void>(`/tenants/${tenantId}/dict/types/${id}`, { method: 'DELETE' }),
    onSuccess: async (_result, id) => { setError(''); if (selectedTypeId === id) setSelectedTypeId(''); await invalidateTypes() },
    onError: (cause) => { setDeleteTarget(null); setError(errorText(cause)) },
  })
  const saveEntry = useMutation({
    mutationFn: (value: EntryDraft) => {
      const { dict_data_id, ...body } = value
      const path = `/tenants/${tenantId}/dict/types/${selectedTypeId}/data`
      return dict_data_id
        ? api<DictEntry>(`${path}/${dict_data_id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api<DictEntry>(path, { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: async () => { setError(''); setEntryError(''); setEntryDraft(null); await invalidateEntries() },
    onError: (cause) => setEntryError(errorText(cause)),
  })
  const deleteEntry = useMutation({
    mutationFn: (id: string) => api<void>(`/tenants/${tenantId}/dict/types/${selectedTypeId}/data/${id}`, { method: 'DELETE' }),
    onSuccess: async () => { setError(''); await invalidateEntries() },
    onError: (cause) => { setDeleteTarget(null); setError(errorText(cause)) },
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
  if (tenant.isError) return <main className="space-y-4 p-6"><ErrorBox message={errorText(tenant.error)} /></main>
  if (!canManage) return <main className="space-y-4 p-6"><ErrorBox message="仅租户所有者或管理员可以管理字典。" /></main>
  if (!tenantActive) return <main className="space-y-4 p-6"><ErrorBox message="租户未启用，无法管理字典。" /></main>

  const typesItems = types.data?.items ?? []
  const sortedTypes = sortRows(typesItems, typeSorting, (row, key) => {
    switch (key) {
      case 'name':
        return row.dict_name
      case 'type':
        return row.dict_type
      case 'order':
        return row.order_num
      case 'status':
        return row.status
      default:
        return ''
    }
  })
  const sortedEntries = sortRows(
    entries.data?.items ?? [],
    entrySorting,
    (row, key) => {
      switch (key) {
        case 'label':
          return row.dict_label
        case 'value':
          return row.dict_value
        case 'order':
          return row.dict_sort
        case 'default':
          return row.is_default
        case 'status':
          return row.status
        default:
          return ''
      }
    }
  )
  const canReorderTypes =
    !typeSorting ||
    (typeSorting.key === 'order' && typeSorting.direction === 'asc')
  const canReorderEntries =
    !entrySorting ||
    (entrySorting.key === 'order' && entrySorting.direction === 'asc')
  const typeBusy = saveType.isPending || deleteType.isPending || reorderType.isPending
  const entryBusy = saveEntry.isPending || deleteEntry.isPending || reorderEntry.isPending
  return <main className="space-y-5 p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold"><LocalizedText text={"租户字典"} /></h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground"><LocalizedText text={"管理当前租户的字典类型和条目。每个租户可独立使用相同类型标识。"} /></p></div>
      <button className={primary} onClick={() => { setError(''); setTypeError(''); setTypeDraft(emptyTypeDraft()) }}><LocalizedText text={"创建字典类型"} /></button></header>
    {error && <ErrorBox message={error} />}
    {typeDraft && <TypeEditor draft={typeDraft} pending={saveType.isPending} error={typeError} onChange={setTypeDraft} onCancel={() => { setTypeDraft(null); setTypeError('') }} onSave={() => saveType.mutate(typeDraft)} />}
    <section className={`${panel} space-y-4`}>
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold"><LocalizedText text={"字典类型"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText text={"可按名称或标识筛选；上移/下移会重排当前租户全部类型。"} /></p></div><div className="flex flex-wrap gap-2"><LocalizedNativeSelect aria-label="类型搜索字段" className={`${input} max-w-36`} value={typeSearchField} onChange={(event) => { setTypeSearchField(event.target.value as 'dict_name' | 'dict_type'); setTypePage(1) }}><option value="dict_name"><LocalizedText text={"名称"} /></option><option value="dict_type"><LocalizedText text={"标识"} /></option></LocalizedNativeSelect><Input aria-label="搜索字典类型" className={`${input} max-w-64`} value={typeSearch} placeholder={typeSearchField === 'dict_name' ? "按名称筛选" : "按标识筛选"} onChange={(event) => { setTypeSearch(event.target.value); setTypePage(1) }} /><LocalizedNativeSelect aria-label="类型状态筛选" className={`${input} max-w-40`} value={typeStatus} onChange={(event) => { setTypeStatus(event.target.value); setTypePage(1) }}><option value=""><LocalizedText text={"全部状态"} /></option><option value="0"><LocalizedText text={"启用"} /></option><option value="1"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect></div></div>
      <div className="overflow-hidden rounded-md border">
        <div className="overflow-x-auto">
          <Table className="min-w-[50rem]">
            <TableHeader>
              <TableRow className="bg-muted/35 hover:bg-muted/35">
                <SortableTableHead label={<LocalizedText text='名称' />} sortKey='name' sorting={typeSorting} onSortingChange={setTypeSorting} />
                <SortableTableHead label={<LocalizedText text='类型标识' />} sortKey='type' sorting={typeSorting} onSortingChange={setTypeSorting} />
                <SortableTableHead label={<LocalizedText text='排序' />} sortKey='order' sorting={typeSorting} onSortingChange={setTypeSorting} />
                <SortableTableHead label={<LocalizedText text='状态' />} sortKey='status' sorting={typeSorting} onSortingChange={setTypeSorting} />
                <TableHead><LocalizedText text='操作' /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.isLoading ? (
                <DataTableSkeletonRows columnCount={5} />
              ) : types.isError ? (
                <TableRow><TableCell colSpan={5}><ErrorBox message={errorText(types.error)} /></TableCell></TableRow>
              ) : sortedTypes.length ? (
                sortedTypes.map((row) => (
                  <TableRow key={row.dict_type_id} data-state={selectedTypeId === row.dict_type_id ? 'selected' : undefined}>
                    <TableCell className="font-medium">{row.dict_name}</TableCell>
                    <TableCell><code>{row.dict_type}</code></TableCell>
                    <TableCell>{row.order_num}</TableCell>
                    <TableCell>{row.status === '0' ? <LocalizedText text='启用' /> : <LocalizedText text='停用' />}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 whitespace-nowrap">
                        <button className="underline" onClick={() => { setSelectedTypeId(row.dict_type_id); setEntryPage(1); setEntrySearch(''); setEntryStatus(''); setEntryDraft(null); setError('') }}><LocalizedText text='管理条目' /></button>
                        <button className="underline disabled:opacity-50" disabled={typeBusy || !canReorderTypes} onClick={() => reorderType.mutate({ id: row.dict_type_id, delta: -1 })}><LocalizedText text='上移' /></button>
                        <button className="underline disabled:opacity-50" disabled={typeBusy || !canReorderTypes} onClick={() => reorderType.mutate({ id: row.dict_type_id, delta: 1 })}><LocalizedText text='下移' /></button>
                        <button className="underline" onClick={() => { setError(''); setTypeDraft(toTypeDraft(row)) }}><LocalizedText text='编辑' /></button>
                        <button className="underline disabled:opacity-50" disabled={typeBusy} onClick={() => saveType.mutate({ ...toTypeDraft(row), status: row.status === '0' ? '1' : '0' })}>{row.status === '0' ? <LocalizedText text='停用' /> : <LocalizedText text='启用' />}</button>
                        <button className="text-destructive underline disabled:opacity-50" disabled={typeBusy} onClick={() => setDeleteTarget({ kind: 'type', row })}><LocalizedText text='删除' /></button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground"><LocalizedText text='暂无字典类型' /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <Pager page={typePage} size={20} total={types.data?.total ?? 0} setPage={setTypePage} />
    </section>
    <Dialog open={Boolean(selectedTypeId)} onOpenChange={(open) => { if (!open) { setSelectedTypeId(''); setEntryDraft(null) } }}>
      <DialogContent className="max-h-[min(88vh,48rem)] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle><LocalizedText text={"字典条目："} />{selectedType.data?.dict_name}</DialogTitle>
          <DialogDescription>
            {selectedType.data ? <><code>{selectedType.data.dict_type}</code> <LocalizedText text={" · 类型状态："} />{selectedType.data.status === '0' ? <LocalizedText text={"启用"} /> : <LocalizedText text={"停用"} />}</> : <LocalizedText text={"管理当前字典类型下的条目。"} />}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {selectedType.isLoading ? <p className="text-sm text-muted-foreground"><LocalizedText text={"正在加载类型…"} /></p> : selectedType.isError ? <ErrorBox message={errorText(selectedType.error)} /> : <>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground"><LocalizedText text={"可在此新增、编辑、排序和启停字典条目。"} /></p></div><button className={primary} onClick={() => { setError(''); setEntryError(''); setEntryDraft(emptyEntryDraft()) }}><LocalizedText text={"创建条目"} /></button></div>
            {entryDraft && <EntryEditor draft={entryDraft} pending={saveEntry.isPending} error={entryError} onChange={setEntryDraft} onCancel={() => { setEntryDraft(null); setEntryError('') }} onSave={() => saveEntry.mutate(entryDraft)} />}
            <div className="flex flex-wrap gap-2"><Input aria-label="搜索字典条目" className={`${input} max-w-64`} value={entrySearch} placeholder="按标签搜索" onChange={(event) => { setEntrySearch(event.target.value); setEntryPage(1) }} /><LocalizedNativeSelect aria-label="条目状态筛选" className={`${input} max-w-40`} value={entryStatus} onChange={(event) => { setEntryStatus(event.target.value); setEntryPage(1) }}><option value=""><LocalizedText text={"全部状态"} /></option><option value="0"><LocalizedText text={"启用"} /></option><option value="1"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect></div>
            <div className="overflow-hidden rounded-md border">
              <div className="overflow-x-auto">
                <Table className="min-w-[58rem]">
                  <TableHeader>
                    <TableRow className="bg-muted/35 hover:bg-muted/35">
                      <SortableTableHead label={<LocalizedText text='标签' />} sortKey='label' sorting={entrySorting} onSortingChange={setEntrySorting} />
                      <SortableTableHead label={<LocalizedText text='键值' />} sortKey='value' sorting={entrySorting} onSortingChange={setEntrySorting} />
                      <SortableTableHead label={<LocalizedText text='排序' />} sortKey='order' sorting={entrySorting} onSortingChange={setEntrySorting} />
                      <SortableTableHead label={<LocalizedText text='默认' />} sortKey='default' sorting={entrySorting} onSortingChange={setEntrySorting} />
                      <SortableTableHead label={<LocalizedText text='状态' />} sortKey='status' sorting={entrySorting} onSortingChange={setEntrySorting} />
                      <TableHead><LocalizedText text='操作' /></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.isLoading ? (
                      <DataTableSkeletonRows columnCount={6} />
                    ) : entries.isError ? (
                      <TableRow><TableCell colSpan={6}><ErrorBox message={errorText(entries.error)} /></TableCell></TableRow>
                    ) : sortedEntries.length ? (
                      sortedEntries.map((row) => (
                        <TableRow key={row.dict_data_id}>
                          <TableCell>{row.dict_label}</TableCell>
                          <TableCell><code>{row.dict_value}</code></TableCell>
                          <TableCell>{row.dict_sort}</TableCell>
                          <TableCell>{row.is_default === 'Y' ? <LocalizedText text='是' /> : <LocalizedText text='否' />}</TableCell>
                          <TableCell>{row.status === '0' ? <LocalizedText text='启用' /> : <LocalizedText text='停用' />}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 whitespace-nowrap">
                              <button className="underline disabled:opacity-50" disabled={entryBusy || !canReorderEntries} onClick={() => reorderEntry.mutate({ id: row.dict_data_id, delta: -1 })}><LocalizedText text='上移' /></button>
                              <button className="underline disabled:opacity-50" disabled={entryBusy || !canReorderEntries} onClick={() => reorderEntry.mutate({ id: row.dict_data_id, delta: 1 })}><LocalizedText text='下移' /></button>
                              <button className="underline" onClick={() => { setError(''); setEntryDraft(toEntryDraft(row)) }}><LocalizedText text='编辑' /></button>
                              <button className="underline disabled:opacity-50" disabled={entryBusy} onClick={() => saveEntry.mutate({ ...toEntryDraft(row), status: row.status === '0' ? '1' : '0' })}>{row.status === '0' ? <LocalizedText text='停用' /> : <LocalizedText text='启用' />}</button>
                              <button className="text-destructive underline disabled:opacity-50" disabled={entryBusy} onClick={() => setDeleteTarget({ kind: 'entry', row })}><LocalizedText text='删除' /></button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground"><LocalizedText text='暂无字典条目' /></TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
            <Pager page={entryPage} size={20} total={entries.data?.total ?? 0} setPage={setEntryPage} />
          </>}
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog
      open={Boolean(deleteTarget)}
      onOpenChange={(open) => {
        if (!open && !deleteType.isPending && !deleteEntry.isPending) {
          setDeleteTarget(null)
        }
      }}
      title={deleteTarget?.kind === 'type' ? '删除字典类型' : '删除字典条目'}
      desc={deleteTarget?.kind === 'type' ? '类型下必须没有条目；删除后不能恢复。' : '删除后不能恢复；被其他业务引用时服务端可能拒绝删除。'}
      confirmText='确认删除'
      destructive
      isLoading={deleteType.isPending || deleteEntry.isPending}
      handleConfirm={() => {
        if (!deleteTarget) return
        if (deleteTarget.kind === 'type') {
          deleteType.mutate(deleteTarget.row.dict_type_id, {
            onSuccess: () => setDeleteTarget(null),
          })
        } else {
          deleteEntry.mutate(deleteTarget.row.dict_data_id, {
            onSuccess: () => setDeleteTarget(null),
          })
        }
      }}
    >
      {deleteTarget && (
        <div className='text-sm'>
          <p className='font-medium'>
            {deleteTarget.kind === 'type'
              ? deleteTarget.row.dict_name
              : deleteTarget.row.dict_label}
          </p>
          <code className='text-xs text-muted-foreground'>
            {deleteTarget.kind === 'type'
              ? deleteTarget.row.dict_type
              : deleteTarget.row.dict_value}
          </code>
        </div>
      )}
    </ConfirmDialog>
  </main>
}

function TypeEditor({ draft, pending, error, onChange, onCancel, onSave }: { draft: TypeDraft; pending: boolean; error: string; onChange: (draft: TypeDraft) => void; onCancel: () => void; onSave: () => void }) {
  const set = <K extends keyof TypeDraft>(key: K, value: TypeDraft[K]) => onChange({ ...draft, [key]: value })
  return <FormDialog
    open
    onOpenChange={(open) => { if (!open) onCancel() }}
    title={draft.dict_type_id ? <LocalizedText text={"编辑字典类型"} /> : <LocalizedText text={"创建字典类型"} />}
    formAriaLabel={draft.dict_type_id ? '编辑字典类型' : '创建字典类型'}
    description="定义租户级字典类型，后续可在其下维护条目。"
    error={error}
    submitLabel={draft.dict_type_id ? <LocalizedText text={"保存类型"} /> : <LocalizedText text={"创建类型"} />}
    pending={pending}
    disabled={!draft.dict_name.trim() || !draft.dict_type.trim()}
    onSubmit={onSave}
    onCancel={onCancel}
  >
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm"><span><LocalizedText text={"类型名称"} /></span><Input autoFocus required maxLength={100} className={input} value={draft.dict_name} onChange={(event) => set('dict_name', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"类型标识"} /></span><Input required maxLength={100} pattern="[A-Za-z][A-Za-z0-9_.-]*" className={input} value={draft.dict_type} onChange={(event) => set('dict_type', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"排序"} /></span><Input type="number" min={0} className={input} value={draft.order_num} onChange={(event) => set('order_num', Number(event.target.value))} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"状态"} /></span><LocalizedNativeSelect className={input} value={draft.status} onChange={(event) => set('status', event.target.value as '0' | '1')}><option value="0"><LocalizedText text={"启用"} /></option><option value="1"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm sm:col-span-2"><span><LocalizedText text={"备注"} /></span><textarea maxLength={500} rows={2} className="w-full rounded-md border bg-background p-3" value={draft.remark} onChange={(event) => set('remark', event.target.value)} /></label>
    </div>
  </FormDialog>
}

function EntryEditor({ draft, pending, error, onChange, onCancel, onSave }: { draft: EntryDraft; pending: boolean; error: string; onChange: (draft: EntryDraft) => void; onCancel: () => void; onSave: () => void }) {
  const set = <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) => onChange({ ...draft, [key]: value })
  return <FormDialog
    open
    onOpenChange={(open) => { if (!open) onCancel() }}
    title={draft.dict_data_id ? <LocalizedText text={"编辑字典条目"} /> : <LocalizedText text={"创建字典条目"} />}
    formAriaLabel={draft.dict_data_id ? '编辑字典条目' : '创建字典条目'}
    description="为当前选中的字典类型添加标签、键值和展示样式。"
    error={error}
    submitLabel={draft.dict_data_id ? <LocalizedText text={"保存条目"} /> : <LocalizedText text={"创建条目"} />}
    pending={pending}
    disabled={!draft.dict_label.trim() || !draft.dict_value.trim()}
    onSubmit={onSave}
    onCancel={onCancel}
  >
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="space-y-1 text-sm"><span><LocalizedText text={"标签"} /></span><Input autoFocus required maxLength={100} className={input} value={draft.dict_label} onChange={(event) => set('dict_label', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"键值"} /></span><Input required maxLength={100} className={input} value={draft.dict_value} onChange={(event) => set('dict_value', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"排序"} /></span><Input type="number" min={0} className={input} value={draft.dict_sort} onChange={(event) => set('dict_sort', Number(event.target.value))} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"默认值"} /></span><LocalizedNativeSelect className={input} value={draft.is_default} onChange={(event) => set('is_default', event.target.value as 'Y' | 'N')}><option value="N"><LocalizedText text={"否"} /></option><option value="Y"><LocalizedText text={"是"} /></option></LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"状态"} /></span><LocalizedNativeSelect className={input} value={draft.status} onChange={(event) => set('status', event.target.value as '0' | '1')}><option value="0"><LocalizedText text={"启用"} /></option><option value="1"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"CSS 样式"} /></span><Input maxLength={100} className={input} value={draft.css_class} onChange={(event) => set('css_class', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"列表样式"} /></span><Input maxLength={100} className={input} value={draft.list_class} onChange={(event) => set('list_class', event.target.value)} /></label>
      <label className="space-y-1 text-sm sm:col-span-2 lg:col-span-3"><span><LocalizedText text={"备注"} /></span><textarea maxLength={500} rows={2} className="w-full rounded-md border bg-background p-3" value={draft.remark} onChange={(event) => set('remark', event.target.value)} /></label>
    </div>
  </FormDialog>
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
