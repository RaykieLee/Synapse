import { useCallback, useEffect, useState } from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { Input } from '@/components/ui/input'
import { getRouteApi, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getTenant } from '@/api/tenants'
import { ApiProblem, api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { LocalizedText } from '@/components/localized-text'
import { FormDialog } from '@/components/form-dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useLocale } from '@/lib/i18n'

const rolesRoute = getRouteApi('/_authenticated/tenants/$tenantId/roles')

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
  { key: 'tenant:read', label: '查看租户信息', labelEn: 'View tenant information' },
  { key: 'tenant:update', label: '修改租户设置', labelEn: 'Update tenant settings' },
  { key: 'tenant:archive', label: '归档租户', labelEn: 'Archive tenant' },
  { key: 'tenant_member:manage', label: '管理租户成员', labelEn: 'Manage tenant members' },
] as const
const panel = 'rounded-lg border bg-card p-5 shadow-sm'
const input = 'h-10 rounded-md border bg-background px-3 text-sm'
const button = 'rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50'
const primary = 'rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50'

export function TenantRolesPage() {
  const actor = useAuthStore((state) => state.auth.user)
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId/roles' })
  const searchParams = rolesRoute.useSearch()
  const navigate = rolesRoute.useNavigate()
  const queryClient = useQueryClient()
  const isEnglish = useLocale() === 'en'
  const search = searchParams.q ?? ''
  const status = searchParams.status ?? ''
  const page = searchParams.page ?? 1
  const [draft, setDraft] = useState<RoleDraft | null>(null)
  const [menuRole, setMenuRole] = useState<TenantRole | null>(null)
  const [confirmRoleAction, setConfirmRoleAction] = useState<{ role: TenantRole; action: 'disable' | 'delete' } | null>(null)
  const [error, setError] = useState('')

  const tenantKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'personal', 'tenant']
  const tenant = useQuery({ queryKey: tenantKey, queryFn: () => getTenant(tenantId) })
  const canManage = tenant.data?.tenant_role === 'owner' || tenant.data?.tenant_role === 'admin'
  const normalizedSearch = search.trim()
  const membershipVersion = tenant.data?.membership_version ?? 0
  const roleKey = ['synapse', actor?.user_id ?? 'anonymous', tenantId, 'tenant', 'roles', membershipVersion, page, 20, normalizedSearch, status]
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
    await queryClient.invalidateQueries({ queryKey: tenantKey })
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
    onSuccess: async (_result, roleId) => {
      if (confirmRoleAction?.action === 'delete' && confirmRoleAction.role.role_id === roleId) setConfirmRoleAction(null)
      setError('')
      await refresh()
    },
    onError: (cause) => setError(errorText(cause)),
  })
  const toggle = useMutation({
    mutationFn: ({ roleId, next }: { roleId: string; next: TenantRole['status'] }) => api<TenantRole>(`/tenants/${tenantId}/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify({ status: next }) }),
    onSuccess: async (updatedRole) => {
      if (confirmRoleAction?.action === 'disable' && confirmRoleAction.role.role_id === updatedRole.role_id) setConfirmRoleAction(null)
      setError('')
      await refresh()
    },
    onError: (cause) => setError(errorText(cause)),
  })
  const setRoleFilters = useCallback((next: { q?: string; status?: '' | TenantRole['status']; page?: number }) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        q: next.q ?? previous.q ?? '',
        status: next.status === '' ? undefined : next.status ?? previous.status,
        page: next.page ?? previous.page ?? 1,
      }),
      replace: true,
    })
  }, [navigate])
  const clearFilters = () => setRoleFilters({ q: '', status: '', page: 1 })
  const totalPages = Math.max(1, Math.ceil((roles.data?.total ?? 0) / 20))
  useEffect(() => {
    if (roles.data && page > totalPages) setRoleFilters({ page: totalPages })
  }, [page, roles.data, setRoleFilters, totalPages])

  if (tenant.isLoading) return <main className="p-6"><LocalizedText text={"正在加载租户…"} /></main>
  if (tenant.isError) return <main className="space-y-4 p-6"><ErrorBox message={errorText(tenant.error)} /></main>
  if (!canManage) return <main className="space-y-4 p-6"><ErrorBox message="仅租户所有者或管理员可以管理租户角色。" /></main>

  return <main className="space-y-5 p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold"><LocalizedText text={"租户角色"} /></h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground"><LocalizedText text={"管理自定义角色的租户权限和菜单授权。内置租户身份及 Workspace 角色保持独立；此页不分配角色给成员，也不改变动态导航。"} /></p></div>
      <button className={primary} onClick={() => { setError(''); setDraft(emptyDraft()) }}><LocalizedText text={"创建角色"} /></button>
    </header>
    {error && <ErrorBox message={error} />}
    {draft && <RoleEditor
      draft={draft}
      pending={save.isPending}
      error={error}
      onChange={setDraft}
      onCancel={() => setDraft(null)}
      onSave={() => save.mutate(draft)}
    />}
    {menuRole && <RoleMenuEditor
      key={`${tenantId}:${membershipVersion}:${menuRole.role_id}`}
      tenantId={tenantId}
      actorId={actor?.user_id ?? 'anonymous'}
      membershipVersion={membershipVersion}
      role={menuRole}
      onCancel={() => setMenuRole(null)}
      onError={setError}
      onSaved={async () => { setMenuRole(null); setError(''); await refresh() }}
    />}
    <section className={`${panel} space-y-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <Input className={`${input} min-w-56 flex-1`} maxLength={100} value={search} placeholder={isEnglish ? 'Search role name or key' : '搜索角色名称或标识'} onChange={(event) => setRoleFilters({ q: event.target.value, page: 1 })} />
        <LocalizedNativeSelect aria-label={isEnglish ? 'Filter roles by status' : '角色状态筛选'} className={input} value={status} onChange={(event) => setRoleFilters({ status: event.target.value as '' | TenantRole['status'], page: 1 })}><option value="">{isEnglish ? 'All statuses' : '全部状态'}</option><option value="active">{isEnglish ? 'Active' : '启用'}</option><option value="disabled">{isEnglish ? 'Disabled' : '停用'}</option></LocalizedNativeSelect>
        {(search || status) && <button type="button" className="text-sm underline" onClick={clearFilters}><LocalizedText text={"清除筛选"} /></button>}
      </div>
      {roles.isLoading ? <p className="py-6 text-center text-sm text-muted-foreground"><LocalizedText text={"正在加载角色…"} /></p> : roles.isError ? <ErrorBox message={errorText(roles.error)} /> : roles.data?.items.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3"><LocalizedText text={"角色"} /></th><th className="p-3"><LocalizedText text={"权限标识"} /></th><th className="p-3"><LocalizedText text={"授权集合"} /></th><th className="p-3"><LocalizedText text={"状态"} /></th><th className="p-3"><LocalizedText text={"操作"} /></th></tr></thead><tbody>{roles.data.items.map((role) => <tr className="border-b align-top last:border-0" key={`${role.tenant_id}:${role.role_id}`}><td className="p-3"><span className="font-medium">{role.role_name}</span><span className="block text-xs text-muted-foreground"><LocalizedText text={"顺序 "} />{role.role_sort} <LocalizedText text={" · 租户 "} />{role.tenant_id}</span></td><td className="p-3"><code>{role.role_key}</code></td><td className="max-w-xs p-3 text-muted-foreground">{role.permissions.length ? role.permissions.map((permission) => permissionLabel(permission, isEnglish)).join(isEnglish ? ', ' : '、') : <LocalizedText text={"无授权"} />}</td><td className="p-3">{role.status === 'active' ? <LocalizedText text={"启用"} /> : <LocalizedText text={"停用"} />}</td><td className="space-x-3 whitespace-nowrap p-3"><button className="underline" onClick={() => { setError(''); setDraft(toDraft(role)) }}><LocalizedText text={"编辑"} /></button><button className="underline disabled:opacity-50" disabled={role.status !== 'active'} onClick={() => { setError(''); setMenuRole(role) }}><LocalizedText text={"菜单授权"} /></button><button className="underline" disabled={toggle.isPending || remove.isPending} onClick={() => role.status === 'active' ? setConfirmRoleAction({ role, action: 'disable' }) : toggle.mutate({ roleId: role.role_id, next: 'active' })}>{role.status === 'active' ? <LocalizedText text={"停用"} /> : <LocalizedText text={"启用"} />}</button><button className="text-destructive underline" disabled={remove.isPending || toggle.isPending} onClick={() => setConfirmRoleAction({ role, action: 'delete' })}><LocalizedText text={"删除"} /></button></td></tr>)}</tbody></table></div> : <div className="space-y-2 py-8 text-center text-sm text-muted-foreground"><p><LocalizedText text={search || status ? "没有符合筛选条件的角色。" : "暂无租户角色"} /></p>{(search || status) && <button type="button" className="underline" onClick={clearFilters}><LocalizedText text={"清除筛选"} /></button>}</div>}
      <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground"><LocalizedText text={"共 "} />{roles.data?.total ?? 0} <LocalizedText text={" 个角色"} /></span><div className="flex items-center gap-2"><button className={button} disabled={page <= 1} onClick={() => setRoleFilters({ page: page - 1 })}><LocalizedText text={"上一页"} /></button><span>{page} <LocalizedText text={" / "} />{totalPages}</span><button className={button} disabled={page >= totalPages} onClick={() => setRoleFilters({ page: page + 1 })}><LocalizedText text={"下一页"} /></button></div></div>
    </section>
    <AlertDialog open={Boolean(confirmRoleAction)} onOpenChange={(open) => { if (!open && !remove.isPending && !toggle.isPending) setConfirmRoleAction(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmRoleAction?.action === 'delete' ? <LocalizedText text={"软删除角色"} /> : <LocalizedText text={"停用角色"} />}{confirmRoleAction && `：${confirmRoleAction.role.role_name}`}</AlertDialogTitle>
          <AlertDialogDescription>{confirmRoleAction?.action === 'delete' ? <LocalizedText text={"软删除后，该角色将不可再分配；分配给现有成员的该角色权限会立即失效。确定继续吗？"} /> : <LocalizedText text={"停用后，分配给现有成员的该角色权限会立即失效。确定继续吗？"} />}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <ErrorBox message={error} />}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending || toggle.isPending}><LocalizedText text={"取消"} /></AlertDialogCancel>
          <AlertDialogAction disabled={!confirmRoleAction || remove.isPending || toggle.isPending} onClick={(event) => { event.preventDefault(); if (!confirmRoleAction) return; setError(''); if (confirmRoleAction.action === 'delete') remove.mutate(confirmRoleAction.role.role_id); else toggle.mutate({ roleId: confirmRoleAction.role.role_id, next: 'disabled' }) }}>{remove.isPending || toggle.isPending ? <LocalizedText text={"处理中…"} /> : confirmRoleAction?.action === 'delete' ? <LocalizedText text={"确认软删除"} /> : <LocalizedText text={"确认停用"} />}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>
}

function emptyDraft(): RoleDraft {
  return { role_name: '', role_key: '', role_sort: 0, status: 'active', permissions: [], remark: '' }
}
function toDraft(role: TenantRole): RoleDraft {
  return { role_id: role.role_id, role_name: role.role_name, role_key: role.role_key, role_sort: role.role_sort, status: role.status, permissions: [...role.permissions], remark: role.remark ?? '' }
}

function RoleEditor({ draft, pending, error, onChange, onCancel, onSave }: {
  draft: RoleDraft
  pending: boolean
  error: string
  onChange: (next: RoleDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const isEnglish = useLocale() === 'en'
  const set = <K extends keyof RoleDraft>(key: K, value: RoleDraft[K]) => onChange({ ...draft, [key]: value })
  function togglePermission(permission: string) {
    const selected = new Set(draft.permissions)
    if (selected.has(permission)) selected.delete(permission)
    else selected.add(permission)
    set('permissions', [...selected])
  }
  return <FormDialog
    open
    onOpenChange={(open) => { if (!open) onCancel() }}
    title={draft.role_id ? <LocalizedText text={"编辑角色"} /> : <LocalizedText text={"创建角色"} />}
    formAriaLabel={draft.role_id ? '编辑角色' : '创建角色'}
    description="配置角色基础信息，并选择可授予该角色的租户权限。"
    error={error}
    submitLabel={draft.role_id ? <LocalizedText text={"保存角色"} /> : <LocalizedText text={"创建角色"} />}
    pending={pending}
    disabled={!draft.role_name.trim() || !draft.role_key.trim()}
    onSubmit={onSave}
    onCancel={onCancel}
  >
    <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm"><span><LocalizedText text={"角色名称"} /></span><Input autoFocus required maxLength={30} className={`${input} w-full`} value={draft.role_name} onChange={(event) => set('role_name', event.target.value)} /></label><label className="space-y-1 text-sm"><span><LocalizedText text={"角色标识"} /></span><Input required maxLength={64} pattern="[a-z][a-z0-9_]{0,63}" className={`${input} w-full`} value={draft.role_key} onChange={(event) => set('role_key', event.target.value)} /><span className="block text-xs text-muted-foreground"><LocalizedText text={"小写字母开头，仅含小写字母、数字和下划线"} /></span></label><label className="space-y-1 text-sm"><span><LocalizedText text={"排序"} /></span><Input type="number" min={0} className={`${input} w-full`} value={draft.role_sort} onChange={(event) => set('role_sort', Number(event.target.value))} /></label><label className="space-y-1 text-sm"><span><LocalizedText text={"状态"} /></span><LocalizedNativeSelect className={`${input} w-full`} value={draft.status} onChange={(event) => set('status', event.target.value as RolePayload['status'])}><option value="active"><LocalizedText text={"启用"} /></option><option value="disabled"><LocalizedText text={"停用"} /></option></LocalizedNativeSelect></label></div>
    <fieldset><legend className="mb-2 text-sm font-medium"><LocalizedText text={"租户授权集合"} /></legend><div className="grid gap-2 sm:grid-cols-2">{permissions.map((permission) => <label key={permission.key} className="flex items-center gap-2 rounded-md border p-3 text-sm"><Input type="checkbox" checked={draft.permissions.includes(permission.key)} onChange={() => togglePermission(permission.key)} /><span>{isEnglish ? permission.labelEn : permission.label}</span><code className="ml-auto text-xs text-muted-foreground">{permission.key}</code></label>)}</div></fieldset>
    <label className="block space-y-1 text-sm"><span><LocalizedText text={"备注"} /></span><textarea maxLength={500} rows={3} className="w-full rounded-md border bg-background p-3" value={draft.remark ?? ''} onChange={(event) => set('remark', event.target.value)} /></label>
  </FormDialog>
}

function permissionLabel(key: string, isEnglish: boolean) {
  const permission = permissions.find((item) => item.key === key)
  return permission ? (isEnglish ? permission.labelEn : permission.label) : key
}

function RoleMenuEditor({ tenantId, actorId, membershipVersion, role, onCancel, onError, onSaved }: {
  tenantId: string
  actorId: string
  membershipVersion: number
  role: TenantRole
  onCancel: () => void
  onError: (message: string) => void
  onSaved: () => Promise<void>
}) {
  const client = useQueryClient()
  const isEnglish = useLocale() === 'en'
  const [selected, setSelected] = useState<string[] | null>(null)
  const [confirmPrune, setConfirmPrune] = useState(false)
  const [saveError, setSaveError] = useState('')
  const menuTreeKey = ['synapse', actorId, tenantId, 'tenant', 'menus', membershipVersion, 'tree'] as const
  const roleMenusKey = ['synapse', actorId, tenantId, 'tenant', 'roles', membershipVersion, role.role_id, 'menus'] as const
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
      setConfirmPrune(false)
      setSaveError('')
      await client.invalidateQueries({ queryKey: ['synapse', actorId, tenantId, 'personal', 'tenant'] })
      await client.invalidateQueries({ queryKey: ['synapse', actorId, tenantId, 'tenant', 'menus'] })
      await client.invalidateQueries({ queryKey: ['synapse', actorId, tenantId, 'tenant', 'roles'] })
      onError('')
      await onSaved()
    },
    onError: (cause) => {
      const message = errorText(cause)
      setSaveError(message)
      onError(message)
    },
  })
  const menuById = new Map(allMenus.map((menu) => [menu.menu_id, menu]))
  const historical = (roleMenus.data?.menu_ids ?? []).filter((menuId) => menuById.get(menuId)?.status !== '0')
  const saveMenuGrants = () => {
    setSaveError('')
    onError('')
    if (historical.length > 0) setConfirmPrune(true)
    else save.mutate(selectedIds)
  }
  const toggleMenu = (menuId: string, checked: boolean) => {
    setSelected(checked ? [...new Set([...selectedIds, menuId])] : selectedIds.filter((id) => id !== menuId))
  }
  return <>
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="max-h-[min(85vh,44rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{role.role_name} <LocalizedText text={" · 菜单授权"} /></DialogTitle>
          <DialogDescription>{isEnglish ? 'Only enabled menus in this tenant can be selected. Disabled or deleted historical grants are view-only and will be removed when saved.' : '仅当前租户启用菜单可勾选。停用或已删除的历史授权仅供查看；保存时会从授权集合中移除。'}</DialogDescription>
        </DialogHeader>
    {menuTree.isLoading || roleMenus.isLoading ? <p className="py-5 text-sm text-muted-foreground"><LocalizedText text={"正在加载菜单授权…"} /></p> : menuTree.isError ? <ErrorBox message={errorText(menuTree.error)} /> : roleMenus.isError ? <ErrorBox message={errorText(roleMenus.error)} /> : <>
      {historical.length > 0 && <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3"><h3 className="text-sm font-medium">{isEnglish ? 'Historical grants that cannot be selected again' : '不可重新勾选的历史授权'}</h3><ul className="space-y-1 text-sm text-muted-foreground">{historical.map((menuId) => {
        const menu = menuById.get(menuId)
        return <li key={menuId}>{menu ? (isEnglish ? `${menu.menu_name} (disabled, ID ${menuId})` : `${menu.menu_name}（已停用，ID ${menuId}）`) : isEnglish ? `Deleted menu (ID ${menuId})` : `已删除菜单（ID ${menuId}）`}</li>
      })}</ul></div>}
      {menuTree.data?.items.length ? <div className="max-h-[55vh] space-y-2 overflow-auto rounded-md border p-3">{menuTree.data.items.map((menu) => <MenuGrantNode key={menu.menu_id} menu={menu} depth={0} selected={selectedIds} onToggle={toggleMenu} isEnglish={isEnglish} />)}</div> : <p className="rounded-md border p-5 text-center text-sm text-muted-foreground"><LocalizedText text={"当前租户没有可配置菜单"} /></p>}
      <div className="flex flex-wrap items-center gap-3"><button type="button" className={primary} disabled={!menuTree.data || !roleMenus.data || save.isPending} onClick={saveMenuGrants}>{save.isPending ? <LocalizedText text={"保存中…"} /> : <LocalizedText text={"保存授权"} />}</button><span className="text-sm text-muted-foreground"><LocalizedText text={"已选 "} />{selectedIds.length} <LocalizedText text={" 个启用菜单"} /></span></div>
    </>}
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmPrune} onOpenChange={(open) => { if (!save.isPending) setConfirmPrune(open) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isEnglish ? 'Confirm removal of historical menu grants' : '确认移除历史菜单授权'}</AlertDialogTitle>
          <AlertDialogDescription>{isEnglish ? 'Saving will remove the following grants for disabled or deleted menus from this role. They will not be restored automatically.' : '保存后，以下已停用或已删除菜单的历史授权将从该角色授权集合中移除，之后不会自动恢复。'}</AlertDialogDescription>
        </AlertDialogHeader>
        {saveError && <ErrorBox message={saveError} />}
        <ul className="max-h-40 space-y-1 overflow-auto rounded-md border p-3 text-sm">{historical.map((menuId) => {
          const menu = menuById.get(menuId)
          return <li key={menuId}>{menu ? (isEnglish ? `${menu.menu_name} (disabled)` : `${menu.menu_name}（已停用）`) : isEnglish ? `Deleted menu (ID ${menuId})` : `已删除菜单（ID ${menuId}）`}</li>
        })}</ul>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={save.isPending}><LocalizedText text={"返回检查"} /></AlertDialogCancel>
          <AlertDialogAction disabled={save.isPending} onClick={(event) => { event.preventDefault(); setSaveError(''); onError(''); save.mutate(selectedIds) }}>{save.isPending ? <LocalizedText text={"保存中…"} /> : <LocalizedText text={"确认移除并保存"} />}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}

function MenuGrantNode({ menu, depth, selected, onToggle, isEnglish }: {
  menu: Menu
  depth: number
  selected: string[]
  onToggle: (menuId: string, checked: boolean) => void
  isEnglish: boolean
}) {
  const enabled = menu.status === '0'
  return <div>
    <label className={`flex items-center gap-2 rounded-md border p-2 text-sm ${enabled ? '' : 'text-muted-foreground opacity-70'}`} style={{ marginLeft: `${depth * 1.25}rem` }}>
      <Input type="checkbox" disabled={!enabled} checked={enabled && selected.includes(menu.menu_id)} onChange={(event) => onToggle(menu.menu_id, event.target.checked)} />
      <span>{menu.menu_name}</span><span className="text-xs text-muted-foreground">{menu.menu_type === 'M' ? (isEnglish ? 'Directory' : '目录') : menu.menu_type === 'C' ? (isEnglish ? 'Page' : '页面') : (isEnglish ? 'Action' : '操作')}{enabled ? '' : isEnglish ? ' · Disabled' : ' · 已停用'}</span>{menu.path && <code className="ml-auto text-xs text-muted-foreground">{menu.path}</code>}
    </label>
    {menu.children.map((child) => <MenuGrantNode key={child.menu_id} menu={child} depth={depth + 1} selected={selected} onToggle={onToggle} isEnglish={isEnglish} />)}
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
