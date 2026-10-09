import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiProblem, api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

type Tenant = { tenant_id: string; name: string; status: 'active' | 'suspended' | 'archived'; tenant_role: 'owner' | 'admin' | 'member' | null }
type TenantRole = {
  role_id: string
  tenant_id: string
  scope: 'tenant'
  role_name: string
  role_key: string
  role_sort: number
  status: 'active' | 'disabled'
  permissions: string[]
  remark: string | null
  created_at: string | null
  updated_at: string | null
}
type RolePage = { items: TenantRole[]; total: number; page: number; page_size: number }
type RolePayload = Pick<TenantRole, 'role_name' | 'role_key' | 'role_sort' | 'status' | 'permissions' | 'remark'>
type RoleDraft = RolePayload & { role_id?: string }
type Menu = {
  menu_id: string
  tenant_id: string
  menu_name: string
  parent_id: string | null
  order_num: number
  path: string
  menu_type: 'M' | 'C' | 'F'
  status: '0' | '1'
  children: Menu[]
}
type MenuTree = { items: Menu[] }
type RoleMenuSet = { tenant_id: string; role_id: string; menu_ids: string[] }

const permissions = [
  { key: 'tenant:read', label: '查看租户信息' },
  { key: 'tenant:update', label: '修改租户设置' },
  { key: 'tenant:archive', label: '归档租户' },
  { key: 'tenant_member:manage', label: '管理租户成员' },
] as const
const panel = 'rounded-lg border bg-card p-5 shadow-sm'
const input = 'h-10 rounded-md border bg-background px-3 text-sm'
const button = 'rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50'
const primary = 'rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50'

export function TenantRolesPage() {
  const actor = useAuthStore((state) => state.auth.user)
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId/roles' })
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState<RoleDraft | null>(null)
  const [menuRole, setMenuRole] = useState<TenantRole | null>(null)
  const [error, setError] = useState('')

  const tenantKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'personal', 'tenant']
  const tenant = useQuery({ queryKey: tenantKey, queryFn: () => api<Tenant>(`/tenants/${tenantId}`) })
  const canManage = tenant.data?.tenant_role === 'owner' || tenant.data?.tenant_role === 'admin'
  const normalizedSearch = search.trim()
  const roleKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'tenant', 'roles', page, 20, normalizedSearch, status]
  const roles = useQuery({
    queryKey: roleKey,
    enabled: canManage,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), page_size: '20' })
      if (normalizedSearch) params.set('search', normalizedSearch)
      if (status) params.set('status', status)
      return api<RolePage>(`/tenants/${tenantId}/roles?${params}`)
    },
  })
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'tenant', 'roles'] })
  }
  const save = useMutation({
    mutationFn: (value: RoleDraft) => {
      const { role_id, ...body } = value
      return role_id
        ? api<TenantRole>(`/tenants/${tenantId}/roles/${role_id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api<TenantRole>(`/tenants/${tenantId}/roles`, { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: async () => { setDraft(null); setError(''); await refresh() },
    onError: (cause) => setError(errorText(cause)),
  })
  const remove = useMutation({
    mutationFn: (roleId: string) => api<void>(`/tenants/${tenantId}/roles/${roleId}`, { method: 'DELETE' }),
    onSuccess: async () => { setError(''); await refresh() },
    onError: (cause) => setError(errorText(cause)),
  })
  const toggle = useMutation({
    mutationFn: ({ roleId, next }: { roleId: string; next: TenantRole['status'] }) => api<TenantRole>(`/tenants/${tenantId}/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify({ status: next }) }),
    onSuccess: async () => { setError(''); await refresh() },
    onError: (cause) => setError(errorText(cause)),
  })

  if (tenant.isLoading) return <main className="p-6">正在加载租户…</main>
  if (tenant.isError) return <main className="space-y-4 p-6"><Link className="underline" to="/tenants/$tenantId" params={{ tenantId }}>返回租户</Link><ErrorBox message={errorText(tenant.error)} /></main>
  if (!canManage) return <main className="space-y-4 p-6"><Link className="underline" to="/tenants/$tenantId" params={{ tenantId }}>返回租户</Link><ErrorBox message="仅租户所有者或管理员可以管理租户角色。" /></main>

  const totalPages = Math.max(1, Math.ceil((roles.data?.total ?? 0) / 20))
  return <main className="space-y-5 p-6">
    <Link className="text-sm underline" to="/tenants/$tenantId" params={{ tenantId }}>← 返回 {tenant.data?.name}</Link>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">租户角色</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">管理自定义角色的租户权限和菜单授权。内置租户身份及 Workspace 角色保持独立；此页不分配角色给成员，也不改变动态导航。</p></div>
      <button className={primary} onClick={() => { setError(''); setDraft(emptyDraft()) }}>创建角色</button>
    </header>
    {error && <ErrorBox message={error} />}
    {draft && <RoleEditor
      draft={draft}
      pending={save.isPending}
      onChange={setDraft}
      onCancel={() => setDraft(null)}
      onSave={() => save.mutate(draft)}
    />}
    {menuRole && <RoleMenuEditor
      key={`${tenantId}:${menuRole.role_id}`}
      tenantId={tenantId}
      actorId={actor?.user_id ?? 'anonymous'}
      role={menuRole}
      onCancel={() => setMenuRole(null)}
      onError={setError}
      onSaved={async () => { setMenuRole(null); setError(''); await refresh() }}
    />}
    <section className={`${panel} space-y-4`}>
      <div className="flex flex-wrap gap-3">
        <input className={`${input} min-w-56 flex-1`} value={search} placeholder="搜索角色名称或标识" onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
        <select aria-label="角色状态筛选" className={input} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="">全部状态</option><option value="active">启用</option><option value="disabled">停用</option></select>
      </div>
      {roles.isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">正在加载角色…</p> : roles.isError ? <ErrorBox message={errorText(roles.error)} /> : roles.data?.items.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3">角色</th><th className="p-3">权限标识</th><th className="p-3">授权集合</th><th className="p-3">状态</th><th className="p-3">操作</th></tr></thead><tbody>{roles.data.items.map((role) => <tr className="border-b align-top last:border-0" key={`${role.tenant_id}:${role.role_id}`}><td className="p-3"><span className="font-medium">{role.role_name}</span><span className="block text-xs text-muted-foreground">顺序 {role.role_sort} · 租户 {role.tenant_id}</span></td><td className="p-3"><code>{role.role_key}</code></td><td className="max-w-xs p-3 text-muted-foreground">{role.permissions.length ? role.permissions.map(permissionLabel).join('、') : '无授权'}</td><td className="p-3">{role.status === 'active' ? '启用' : '停用'}</td><td className="space-x-3 whitespace-nowrap p-3"><button className="underline" onClick={() => { setError(''); setDraft(toDraft(role)) }}>编辑</button><button className="underline disabled:opacity-50" disabled={role.status !== 'active'} onClick={() => { setError(''); setMenuRole(role) }}>菜单授权</button><button className="underline" disabled={toggle.isPending} onClick={() => toggle.mutate({ roleId: role.role_id, next: role.status === 'active' ? 'disabled' : 'active' })}>{role.status === 'active' ? '停用' : '启用'}</button><button className="text-destructive underline" disabled={remove.isPending} onClick={() => { if (window.confirm(`软删除角色“${role.role_name}”？`)) remove.mutate(role.role_id) }}>删除</button></td></tr>)}</tbody></table></div> : <p className="py-8 text-center text-sm text-muted-foreground">暂无租户角色</p>}
      <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">共 {roles.data?.total ?? 0} 个角色</span><div className="flex items-center gap-2"><button className={button} disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>{page} / {totalPages}</span><button className={button} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</button></div></div>
    </section>
  </main>
}

function emptyDraft(): RoleDraft {
  return { role_name: '', role_key: '', role_sort: 0, status: 'active', permissions: [], remark: '' }
}
function toDraft(role: TenantRole): RoleDraft {
  return { role_id: role.role_id, role_name: role.role_name, role_key: role.role_key, role_sort: role.role_sort, status: role.status, permissions: [...role.permissions], remark: role.remark ?? '' }
}

function RoleEditor({ draft, pending, onChange, onCancel, onSave }: {
  draft: RoleDraft
  pending: boolean
  onChange: (next: RoleDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const set = <K extends keyof RoleDraft>(key: K, value: RoleDraft[K]) => onChange({ ...draft, [key]: value })
  function togglePermission(permission: string) {
    const selected = new Set(draft.permissions)
    if (selected.has(permission)) selected.delete(permission)
    else selected.add(permission)
    set('permissions', [...selected])
  }
  return <form className={`${panel} space-y-4`} onSubmit={(event) => { event.preventDefault(); onSave() }}>
    <h2 className="font-semibold">{draft.role_id ? '编辑角色' : '创建角色'}</h2>
    <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm"><span>角色名称</span><input autoFocus required maxLength={30} className={`${input} w-full`} value={draft.role_name} onChange={(event) => set('role_name', event.target.value)} /></label><label className="space-y-1 text-sm"><span>角色标识</span><input required maxLength={64} pattern="[a-z][a-z0-9_]{0,63}" className={`${input} w-full`} value={draft.role_key} onChange={(event) => set('role_key', event.target.value)} /><span className="block text-xs text-muted-foreground">小写字母开头，仅含小写字母、数字和下划线</span></label><label className="space-y-1 text-sm"><span>排序</span><input type="number" min={0} className={`${input} w-full`} value={draft.role_sort} onChange={(event) => set('role_sort', Number(event.target.value))} /></label><label className="space-y-1 text-sm"><span>状态</span><select className={`${input} w-full`} value={draft.status} onChange={(event) => set('status', event.target.value as RolePayload['status'])}><option value="active">启用</option><option value="disabled">停用</option></select></label></div>
    <fieldset><legend className="mb-2 text-sm font-medium">租户授权集合</legend><div className="grid gap-2 sm:grid-cols-2">{permissions.map((permission) => <label key={permission.key} className="flex items-center gap-2 rounded-md border p-3 text-sm"><input type="checkbox" checked={draft.permissions.includes(permission.key)} onChange={() => togglePermission(permission.key)} /><span>{permission.label}</span><code className="ml-auto text-xs text-muted-foreground">{permission.key}</code></label>)}</div></fieldset>
    <label className="block space-y-1 text-sm"><span>备注</span><textarea maxLength={500} rows={3} className="w-full rounded-md border bg-background p-3" value={draft.remark ?? ''} onChange={(event) => set('remark', event.target.value)} /></label>
    <div className="flex gap-2"><button className={primary} disabled={pending || !draft.role_name.trim() || !draft.role_key.trim()}>{pending ? '保存中…' : '保存角色'}</button><button type="button" className={button} onClick={onCancel}>取消</button></div>
  </form>
}

function permissionLabel(key: string) {
  return permissions.find((permission) => permission.key === key)?.label ?? key
}

function RoleMenuEditor({ tenantId, actorId, role, onCancel, onError, onSaved }: {
  tenantId: string
  actorId: string
  role: TenantRole
  onCancel: () => void
  onError: (message: string) => void
  onSaved: () => Promise<void>
}) {
  const client = useQueryClient()
  const [selected, setSelected] = useState<string[] | null>(null)
  const menuTreeKey = ['synapse', actorId, tenantId, 'tenant', 'menus', 'tree'] as const
  const roleMenusKey = ['synapse', actorId, tenantId, 'tenant', 'roles', role.role_id, 'menus'] as const
  const menuTree = useQuery({ queryKey: menuTreeKey, queryFn: () => api<MenuTree>(`/tenants/${tenantId}/menus/tree?include_disabled=true`) })
  const roleMenus = useQuery({ queryKey: roleMenusKey, queryFn: () => api<RoleMenuSet>(`/tenants/${tenantId}/roles/${role.role_id}/menus`) })
  const allMenus = flattenTenantMenus(menuTree.data?.items ?? [])
  const assignable = new Set(allMenus.filter((menu) => menu.status === '0').map((menu) => menu.menu_id))
  const selectedIds = selected ?? (roleMenus.data?.menu_ids.filter((menuId) => assignable.has(menuId)) ?? [])
  const save = useMutation({
    mutationFn: (menuIds: string[]) => api<RoleMenuSet>(`/tenants/${tenantId}/roles/${role.role_id}/menus`, {
      method: 'PUT',
      body: JSON.stringify({ menu_ids: [...menuIds].sort((left, right) => Number(left) - Number(right)) }),
    }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: roleMenusKey })
      await client.invalidateQueries({ queryKey: ['synapse', actorId, tenantId, 'personal', 'tenant'] })
      onError('')
      await onSaved()
    },
    onError: (cause) => onError(errorText(cause)),
  })
  const menuById = new Map(allMenus.map((menu) => [menu.menu_id, menu]))
  const historical = (roleMenus.data?.menu_ids ?? []).filter((menuId) => menuById.get(menuId)?.status !== '0')
  const toggleMenu = (menuId: string, checked: boolean) => {
    setSelected(checked ? [...new Set([...selectedIds, menuId])] : selectedIds.filter((id) => id !== menuId))
  }
  return <section className={`${panel} space-y-4`}>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{role.role_name} · 菜单授权</h2><p className="mt-1 text-sm text-muted-foreground">仅当前租户启用菜单可勾选。停用或已删除的历史授权仅供查看；保存时会从授权集合中移除。</p></div><button type="button" className={button} onClick={onCancel}>关闭</button></header>
    {menuTree.isLoading || roleMenus.isLoading ? <p className="py-5 text-sm text-muted-foreground">正在加载菜单授权…</p> : menuTree.isError ? <ErrorBox message={errorText(menuTree.error)} /> : roleMenus.isError ? <ErrorBox message={errorText(roleMenus.error)} /> : <>
      {historical.length > 0 && <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3"><h3 className="text-sm font-medium">不可重新勾选的历史授权</h3><ul className="space-y-1 text-sm text-muted-foreground">{historical.map((menuId) => {
        const menu = menuById.get(menuId)
        return <li key={menuId}>{menu ? `${menu.menu_name}（已停用，ID ${menuId}）` : `已删除菜单（ID ${menuId}）`}</li>
      })}</ul></div>}
      {menuTree.data?.items.length ? <div className="max-h-[55vh] space-y-2 overflow-auto rounded-md border p-3">{menuTree.data.items.map((menu) => <MenuGrantNode key={menu.menu_id} menu={menu} depth={0} selected={selectedIds} onToggle={toggleMenu} />)}</div> : <p className="rounded-md border p-5 text-center text-sm text-muted-foreground">当前租户没有可配置菜单</p>}
      <div className="flex flex-wrap items-center gap-3"><button type="button" className={primary} disabled={!menuTree.data || !roleMenus.data || save.isPending} onClick={() => save.mutate(selectedIds)}>{save.isPending ? '保存中…' : '保存授权'}</button><span className="text-sm text-muted-foreground">已选 {selectedIds.length} 个启用菜单</span></div>
    </>}
  </section>
}

function MenuGrantNode({ menu, depth, selected, onToggle }: {
  menu: Menu
  depth: number
  selected: string[]
  onToggle: (menuId: string, checked: boolean) => void
}) {
  const enabled = menu.status === '0'
  return <div>
    <label className={`flex items-center gap-2 rounded-md border p-2 text-sm ${enabled ? '' : 'text-muted-foreground opacity-70'}`} style={{ marginLeft: `${depth * 1.25}rem` }}>
      <input type="checkbox" disabled={!enabled} checked={enabled && selected.includes(menu.menu_id)} onChange={(event) => onToggle(menu.menu_id, event.target.checked)} />
      <span>{menu.menu_name}</span><span className="text-xs text-muted-foreground">{menu.menu_type === 'M' ? '目录' : menu.menu_type === 'C' ? '页面' : '操作'}{enabled ? '' : ' · 已停用'}</span>{menu.path && <code className="ml-auto text-xs text-muted-foreground">{menu.path}</code>}
    </label>
    {menu.children.map((child) => <MenuGrantNode key={child.menu_id} menu={child} depth={depth + 1} selected={selected} onToggle={onToggle} />)}
  </div>
}

function flattenTenantMenus(items: Menu[]): Menu[] {
  return items.flatMap((menu) => [menu, ...flattenTenantMenus(menu.children)])
}

function errorText(error: unknown) {
  if (error instanceof ApiProblem) {
    if (error.code === 'ROLE_CONFLICT') return '当前租户已有相同角色名称或标识。'
    if (error.code === 'ROLE_MENU_CONFLICT') return '菜单授权已发生并发变更，请重新打开授权配置后再试。'
    if (error.code === 'RESOURCE_NOT_FOUND') return '角色或菜单不存在、已停用或不属于当前租户，请刷新后重试。'
    if (error.code === 'FORBIDDEN' || error.code === 'MEMBERSHIP_INACTIVE') return '当前账号没有此租户的角色管理权限。'
    return `${error.message}${error.code ? `（${error.code}）` : ''}`
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}
function ErrorBox({ message }: { message: string }) {
  return <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{message}</div>
}
