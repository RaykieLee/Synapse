import { useState } from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { Input } from '@/components/ui/input'
import { useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getTenant } from '@/api/tenants'
import { ApiProblem, api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { LocalizedText } from '@/components/localized-text'
import { FormDialog } from '@/components/form-dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'

type Menu = {
  menu_id: string
  tenant_id: string
  menu_name: string
  parent_id: string | null
  order_num: number
  path: string
  component: string | null
  query: string | null
  is_frame: number
  is_cache: number
  menu_type: 'M' | 'C' | 'F'
  visible: '0' | '1'
  status: '0' | '1'
  perms: string | null
  icon: string
  remark: string | null
  children: Menu[]
}
type MenuDraft = Omit<Menu, 'menu_id' | 'tenant_id' | 'children'> & { menu_id?: string }
type MenuOrder = { menu_id: string; parent_id: string | null; order_num: number }
type MenuTree = { items: Menu[] }

const panel = 'rounded-lg border bg-card p-5 shadow-sm'
const input = 'h-10 w-full rounded-md border bg-background px-3 text-sm'
const primary = 'rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50'

export function TenantMenusPage() {
  const actor = useAuthStore((state) => state.auth.user)
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId/menus' })
  const client = useQueryClient()
  const [draft, setDraft] = useState<MenuDraft | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Menu | null>(null)
  const [error, setError] = useState('')
  const tenantKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'personal', 'tenant']
  const tenant = useQuery({ queryKey: tenantKey, queryFn: () => getTenant(tenantId) })
  const canManage = tenant.data?.tenant_role === 'owner' || tenant.data?.tenant_role === 'admin'
  const treeKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'tenant', 'menus', 'tree']
  const tree = useQuery({
    queryKey: treeKey,
    enabled: canManage,
    queryFn: () => api<MenuTree>(`/tenants/${tenantId}/menus/tree?include_disabled=true`),
  })
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'tenant', 'menus'] })
    await client.invalidateQueries({ queryKey: tenantKey })
  }
  const save = useMutation({
    mutationFn: (value: MenuDraft) => {
      const { menu_id, ...body } = value
      return menu_id
        ? api<Menu>(`/tenants/${tenantId}/menus/${menu_id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api<Menu>(`/tenants/${tenantId}/menus`, { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: async () => { setDraft(null); setError(''); await refresh() },
    onError: (cause) => setError(errorText(cause)),
  })
  const reorder = useMutation({
    mutationFn: (items: MenuOrder[]) => api<{ updated: number }>(`/tenants/${tenantId}/menus/reorder`, { method: 'POST', body: JSON.stringify({ items }) }),
    onSuccess: async () => { setError(''); await refresh() },
    onError: (cause) => setError(errorText(cause)),
  })
  const remove = useMutation({
    mutationFn: (menuId: string) => api<void>(`/tenants/${tenantId}/menus/${menuId}`, { method: 'DELETE' }),
    onSuccess: async () => { setRemoveTarget(null); setError(''); await refresh() },
    onError: (cause) => { setRemoveTarget(null); setError(errorText(cause)) },
  })
  const toggle = useMutation({
    mutationFn: ({ menuId, status }: { menuId: string; status: '0' | '1' }) => api<Menu>(`/tenants/${tenantId}/menus/${menuId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: async () => { setError(''); await refresh() },
    onError: (cause) => setError(errorText(cause)),
  })

  if (tenant.isLoading) return <main className="p-6"><LocalizedText text={"正在加载租户…"} /></main>
  if (tenant.isError) return <main className="space-y-4 p-6"><ErrorBox message={errorText(tenant.error)} /></main>
  if (!canManage) return <main className="space-y-4 p-6"><ErrorBox message="仅租户所有者或管理员可以管理租户菜单。" /></main>

  const menus = tree.data?.items ?? []
  const allMenus = flatten(menus)
  const moveSibling = (siblings: Menu[], index: number, delta: -1 | 1) => {
    const next = index + delta
    if (next < 0 || next >= siblings.length) return
    const reordered = [...siblings]
    ;[reordered[index], reordered[next]] = [reordered[next], reordered[index]]
    reorder.mutate(reordered.map((menu, order) => ({ menu_id: menu.menu_id, parent_id: menu.parent_id, order_num: (order + 1) * 10 })))
  }
  return <main className="space-y-5 p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold"><LocalizedText text={"租户菜单"} /></h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground"><LocalizedText text={"管理当前租户的目录、页面和操作元数据。此处不会修改系统内置导航或角色菜单授权。"} /></p></div><button className={primary} onClick={() => { setError(''); setDraft(emptyDraft()) }}><LocalizedText text={"创建菜单"} /></button></header>
    {error && <ErrorBox message={error} />}
    {draft && <MenuEditor draft={draft} menus={allMenus} pending={save.isPending} error={error} onChange={setDraft} onCancel={() => setDraft(null)} onSave={() => save.mutate(draft)} />}
    <section className={`${panel} space-y-4`}>
      <div><h2 className="font-semibold"><LocalizedText text={"菜单树"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText text={"同级菜单可用上移/下移调整顺序。已停用项会保留在树中并标明状态。"} /></p></div>
      {tree.isLoading ? <p className="py-6 text-center text-sm text-muted-foreground"><LocalizedText text={"正在加载菜单…"} /></p> : tree.isError ? <ErrorBox message={errorText(tree.error)} /> : menus.length ? <div className="space-y-2">{menus.map((menu, index) => <MenuTreeNode key={menu.menu_id} menu={menu} siblings={menus} index={index} depth={0} pending={reorder.isPending || toggle.isPending || remove.isPending} onEdit={(value) => { setError(''); setDraft(toDraft(value)) }} onMove={moveSibling} onToggle={(value) => toggle.mutate({ menuId: value.menu_id, status: value.status === '0' ? '1' : '0' })} onDelete={setRemoveTarget} />)}</div> : <p className="py-8 text-center text-sm text-muted-foreground"><LocalizedText text={"暂无菜单"} /></p>}
    </section>
    <ConfirmDialog
      open={Boolean(removeTarget)}
      onOpenChange={(open) => { if (!open && !remove.isPending) setRemoveTarget(null) }}
      title="删除菜单"
      desc="有子菜单时服务端会拒绝删除。删除后不能恢复。"
      confirmText="确认删除"
      destructive
      isLoading={remove.isPending}
      handleConfirm={() => { if (removeTarget) remove.mutate(removeTarget.menu_id) }}
    >
      {removeTarget && <p className='text-sm font-medium'>{removeTarget.menu_name}</p>}
    </ConfirmDialog>
  </main>
}

function MenuTreeNode({ menu, siblings, index, depth, pending, onEdit, onMove, onToggle, onDelete }: {
  menu: Menu
  siblings: Menu[]
  index: number
  depth: number
  pending: boolean
  onEdit: (menu: Menu) => void
  onMove: (siblings: Menu[], index: number, delta: -1 | 1) => void
  onToggle: (menu: Menu) => void
  onDelete: (menu: Menu) => void
}) {
  const typeLabel = menu.menu_type === 'M' ? '目录' : menu.menu_type === 'C' ? '页面' : '操作'
  return <div>
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-3" style={{ marginLeft: `${depth * 1.25}rem` }}>
      <span className="min-w-32 font-medium">{menu.menu_name}</span><span className="text-xs text-muted-foreground">{typeLabel} <LocalizedText text={" · "} />{menu.status === '0' ? <LocalizedText text={"启用"} /> : <LocalizedText text={"停用"} />} <LocalizedText text={" · 顺序 "} />{menu.order_num}</span>
      {menu.path && <code className="text-xs">{menu.path}</code>}{menu.perms && <code className="text-xs text-muted-foreground">{menu.perms}</code>}
      <div className="ml-auto flex flex-wrap gap-2"><button className="underline disabled:opacity-50" disabled={pending || index === 0} onClick={() => onMove(siblings, index, -1)}><LocalizedText text={"上移"} /></button><button className="underline disabled:opacity-50" disabled={pending || index === siblings.length - 1} onClick={() => onMove(siblings, index, 1)}><LocalizedText text={"下移"} /></button><button className="underline" onClick={() => onEdit(menu)}><LocalizedText text={"编辑"} /></button><button className="underline disabled:opacity-50" disabled={pending} onClick={() => onToggle(menu)}>{menu.status === '0' ? <LocalizedText text={"停用"} /> : <LocalizedText text={"启用"} />}</button><button className="text-destructive underline disabled:opacity-50" disabled={pending} onClick={() => onDelete(menu)}><LocalizedText text={"删除"} /></button></div>
    </div>
    {menu.children.map((child, childIndex) => <MenuTreeNode key={child.menu_id} menu={child} siblings={menu.children} index={childIndex} depth={depth + 1} pending={pending} onEdit={onEdit} onMove={onMove} onToggle={onToggle} onDelete={onDelete} />)}
  </div>
}

function MenuEditor({ draft, menus, pending, error, onChange, onCancel, onSave }: {
  draft: MenuDraft
  menus: Menu[]
  pending: boolean
  error: string
  onChange: (next: MenuDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const set = <K extends keyof MenuDraft>(key: K, value: MenuDraft[K]) => onChange({ ...draft, [key]: value })
  const descendants = new Set<string>()
  if (draft.menu_id) {
    const visit = (id: string) => menus.filter((menu) => menu.parent_id === id).forEach((child) => { descendants.add(child.menu_id); visit(child.menu_id) })
    visit(draft.menu_id)
  }
  const parentOptions = menus.filter((menu) => menu.menu_id !== draft.menu_id && !descendants.has(menu.menu_id))
  return <FormDialog
    open
    onOpenChange={(open) => { if (!open) onCancel() }}
    title={draft.menu_id ? <LocalizedText text={"编辑菜单"} /> : <LocalizedText text={"创建菜单"} />}
    formAriaLabel={draft.menu_id ? '编辑菜单' : '创建菜单'}
    description="配置菜单层级、路由元数据、权限标识和展示状态。"
    error={error}
    submitLabel={draft.menu_id ? <LocalizedText text={"保存菜单"} /> : <LocalizedText text={"创建菜单"} />}
    pending={pending}
    disabled={!draft.menu_name.trim()}
    onSubmit={onSave}
    onCancel={onCancel}
  >
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="space-y-1 text-sm"><span><LocalizedText text={"名称"} /></span><Input autoFocus required maxLength={50} className={input} value={draft.menu_name} onChange={(event) => set('menu_name', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"父级菜单"} /></span><LocalizedNativeSelect className={input} value={draft.parent_id ?? ''} onChange={(event) => set('parent_id', event.target.value || null)}><option value=""><LocalizedText text={"顶级菜单"} /></option>{parentOptions.map((menu) => <option key={menu.menu_id} value={menu.menu_id}>{menu.menu_name}</option>)}</LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"菜单类型"} /></span><LocalizedNativeSelect className={input} value={draft.menu_type} onChange={(event) => set('menu_type', event.target.value as MenuDraft['menu_type'])}><option value="M"><LocalizedText text={"目录"} /></option><option value="C"><LocalizedText text={"页面"} /></option><option value="F"><LocalizedText text={"操作"} /></option></LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"排序"} /></span><Input type="number" min={0} className={input} value={draft.order_num} onChange={(event) => set('order_num', Number(event.target.value))} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"路由地址"} /></span><Input maxLength={200} className={input} value={draft.path} onChange={(event) => set('path', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"组件路径"} /></span><Input maxLength={255} className={input} value={draft.component ?? ''} onChange={(event) => set('component', event.target.value || null)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"路由参数"} /></span><Input maxLength={255} className={input} value={draft.query ?? ''} onChange={(event) => set('query', event.target.value || null)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"权限标识"} /></span><Input maxLength={100} className={input} value={draft.perms ?? ''} onChange={(event) => set('perms', event.target.value || null)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"图标"} /></span><Input maxLength={100} className={input} value={draft.icon} onChange={(event) => set('icon', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"状态"} /></span><LocalizedNativeSelect className={input} value={draft.status} onChange={(event) => set('status', event.target.value as '0' | '1')}><option value="0"><LocalizedText text={"启用"} /></option><option value="1"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"可见性"} /></span><LocalizedNativeSelect className={input} value={draft.visible} onChange={(event) => set('visible', event.target.value as '0' | '1')}><option value="0"><LocalizedText text={"显示"} /></option><option value="1"><LocalizedText text={"隐藏"} /></option></LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"链接类型"} /></span><LocalizedNativeSelect className={input} value={draft.is_frame} onChange={(event) => set('is_frame', Number(event.target.value) as 0 | 1)}><option value={1}><LocalizedText text={"站内路由"} /></option><option value={0}><LocalizedText text={"外部链接"} /></option></LocalizedNativeSelect></label>
      <label className="space-y-1 text-sm"><span><LocalizedText text={"缓存"} /></span><LocalizedNativeSelect className={input} value={draft.is_cache} onChange={(event) => set('is_cache', Number(event.target.value) as 0 | 1)}><option value={0}><LocalizedText text={"允许缓存"} /></option><option value={1}><LocalizedText text={"不缓存"} /></option></LocalizedNativeSelect></label>
    </div>
    <label className="block space-y-1 text-sm"><span><LocalizedText text={"备注"} /></span><textarea maxLength={500} rows={2} className="w-full rounded-md border bg-background p-3" value={draft.remark ?? ''} onChange={(event) => set('remark', event.target.value || null)} /></label>
  </FormDialog>
}

function emptyDraft(): MenuDraft {
  return { menu_name: '', parent_id: null, order_num: 0, path: '', component: null, query: null, is_frame: 1, is_cache: 0, menu_type: 'M', visible: '0', status: '0', perms: null, icon: '#', remark: null }
}
function toDraft(menu: Menu): MenuDraft {
  return { menu_id: menu.menu_id, menu_name: menu.menu_name, parent_id: menu.parent_id, order_num: menu.order_num, path: menu.path, component: menu.component, query: menu.query, is_frame: menu.is_frame, is_cache: menu.is_cache, menu_type: menu.menu_type, visible: menu.visible, status: menu.status, perms: menu.perms, icon: menu.icon, remark: menu.remark }
}
function flatten(items: Menu[]): Menu[] {
  return items.flatMap((menu) => [menu, ...flatten(menu.children)])
}
function errorText(error: unknown) {
  if (error instanceof ApiProblem) {
    if (error.code === 'FORBIDDEN' || error.code === 'MEMBERSHIP_INACTIVE') return '当前账号没有此租户的菜单管理权限。'
    if (error.code === 'MENU_HAS_CHILDREN') return '请先删除或移动此菜单下的子菜单。'
    if (error.code === 'MENU_CYCLE') return '菜单父级关系不能形成循环。'
    if (error.code === 'MENU_PARENT_INACTIVE') return '父级菜单已停用，请选择其他父级。'
    if (error.code === 'RESOURCE_NOT_FOUND') return '菜单或父级不存在，或不属于当前租户。'
    return `${error.message}${error.code ? `（${error.code}）` : ''}`
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}
function ErrorBox({ message }: { message: string }) {
  return <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{message}</div>
}
