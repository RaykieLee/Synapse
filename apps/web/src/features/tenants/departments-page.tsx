import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiProblem, api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

type Tenant = { tenant_id: string; name: string; tenant_role: 'owner' | 'admin' | 'member' | null }
type Department = {
  department_id: string
  tenant_id: string
  parent_id: string | null
  ancestors: string
  dept_name: string
  order_num: number
  leader: string | null
  phone: string | null
  email: string | null
  status: '0' | '1'
  children: Department[]
}
type DepartmentTree = { items: Department[] }
type DepartmentDraft = { department_id?: string; dept_name: string; parent_id: string | null; order_num: number; leader: string; phone: string; email: string; status: '0' | '1' }
type DepartmentOrder = { department_id: string; parent_id: string | null; order_num: number }

const panel = 'rounded-lg border bg-card p-5 shadow-sm'
const input = 'h-10 w-full rounded-md border bg-background px-3 text-sm'
const button = 'rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50'
const primary = 'rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50'

export function TenantDepartmentsPage() {
  const actor = useAuthStore((state) => state.auth.user)
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId/departments' })
  const client = useQueryClient()
  const [draft, setDraft] = useState<DepartmentDraft | null>(null)
  const [error, setError] = useState('')
  const actorId = actor?.user_id ?? 'anonymous'
  const tenantKey = ['synapse', actorId, tenantId, 'personal', 'tenant']
  const tenant = useQuery({ queryKey: tenantKey, queryFn: () => api<Tenant>(`/tenants/${tenantId}`) })
  const canManage = tenant.data?.tenant_role === 'owner' || tenant.data?.tenant_role === 'admin'
  const treeKey = ['synapse', actorId, tenantId, 'tenant', 'departments', 'tree']
  const tree = useQuery({
    queryKey: treeKey,
    enabled: canManage,
    queryFn: () => api<DepartmentTree>(`/tenants/${tenantId}/departments/tree?include_disabled=true`),
  })
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['synapse', actorId, tenantId, 'tenant', 'departments'] })
    await client.invalidateQueries({ queryKey: tenantKey })
  }
  const save = useMutation({
    mutationFn: (value: DepartmentDraft) => {
      const { department_id, ...body } = value
      return department_id
        ? api<Department>(`/tenants/${tenantId}/departments/${department_id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api<Department>(`/tenants/${tenantId}/departments`, { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: async () => { setDraft(null); setError(''); await invalidate() },
    onError: (cause) => setError(errorText(cause)),
  })
  const reorder = useMutation({
    mutationFn: (items: DepartmentOrder[]) => api<{ updated: number }>(`/tenants/${tenantId}/departments/reorder`, { method: 'POST', body: JSON.stringify({ items }) }),
    onSuccess: async () => { setError(''); await invalidate() },
    onError: (cause) => setError(errorText(cause)),
  })
  const toggle = useMutation({
    mutationFn: ({ departmentId, status }: { departmentId: string; status: '0' | '1' }) => api<Department>(`/tenants/${tenantId}/departments/${departmentId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: async () => { setError(''); await invalidate() },
    onError: (cause) => setError(errorText(cause)),
  })
  const remove = useMutation({
    mutationFn: (departmentId: string) => api<void>(`/tenants/${tenantId}/departments/${departmentId}`, { method: 'DELETE' }),
    onSuccess: async () => { setError(''); await invalidate() },
    onError: (cause) => setError(errorText(cause)),
  })

  if (tenant.isLoading) return <main className="p-6">正在加载租户…</main>
  if (tenant.isError) return <main className="space-y-4 p-6"><Link className="underline" to="/tenants/$tenantId" params={{ tenantId }}>返回租户</Link><ErrorBox message={errorText(tenant.error)} /></main>
  if (!canManage) return <main className="space-y-4 p-6"><Link className="underline" to="/tenants/$tenantId" params={{ tenantId }}>返回租户</Link><ErrorBox message="仅租户所有者或管理员可以管理部门。" /></main>

  const departments = tree.data?.items ?? []
  const flat = flatten(departments)
  const moveSibling = (siblings: Department[], index: number, delta: -1 | 1) => {
    const next = index + delta
    if (next < 0 || next >= siblings.length) return
    const ordered = [...siblings]
    ;[ordered[index], ordered[next]] = [ordered[next], ordered[index]]
    reorder.mutate(ordered.map((department, order) => ({ department_id: department.department_id, parent_id: department.parent_id, order_num: (order + 1) * 10 })))
  }

  return <main className="space-y-5 p-6">
    <Link className="text-sm underline" to="/tenants/$tenantId" params={{ tenantId }}>← 返回 {tenant.data?.name}</Link>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">租户部门</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">管理当前租户的部门层级、排序和状态。部门不会自动关联租户成员。</p></div><button className={primary} onClick={() => { setError(''); setDraft(emptyDraft()) }}>创建部门</button></header>
    {error && <ErrorBox message={error} />}
    {draft && <DepartmentEditor draft={draft} departments={flat} pending={save.isPending} onChange={setDraft} onCancel={() => setDraft(null)} onSave={() => save.mutate(draft)} />}
    <section className={`${panel} space-y-4`}>
      <div><h2 className="font-semibold">部门树</h2><p className="text-sm text-muted-foreground">上移或下移调整同级顺序；编辑部门可移动到其他有效父级。停用部门会保留在树中。</p></div>
      {tree.isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">正在加载部门…</p> : tree.isError ? <ErrorBox message={errorText(tree.error)} /> : departments.length ? <div className="space-y-2">{departments.map((department, index) => <DepartmentTreeNode key={department.department_id} department={department} siblings={departments} index={index} depth={0} pending={reorder.isPending || toggle.isPending || remove.isPending} onEdit={(value) => { setError(''); setDraft(toDraft(value)) }} onMove={moveSibling} onToggle={(value) => toggle.mutate({ departmentId: value.department_id, status: value.status === '0' ? '1' : '0' })} onDelete={(value) => { if (window.confirm(`删除部门“${value.dept_name}”？有子部门时服务端会拒绝删除。`)) remove.mutate(value.department_id) }} />)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">暂无部门</p>}
    </section>
  </main>
}

function DepartmentTreeNode({ department, siblings, index, depth, pending, onEdit, onMove, onToggle, onDelete }: {
  department: Department
  siblings: Department[]
  index: number
  depth: number
  pending: boolean
  onEdit: (department: Department) => void
  onMove: (siblings: Department[], index: number, delta: -1 | 1) => void
  onToggle: (department: Department) => void
  onDelete: (department: Department) => void
}) {
  return <div>
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-3" style={{ marginLeft: `${depth * 1.25}rem` }}>
      <span className="min-w-32 font-medium">{department.dept_name}</span><span className="text-xs text-muted-foreground">{department.status === '0' ? '启用' : '停用'} · 顺序 {department.order_num}</span>
      {department.leader && <span className="text-xs text-muted-foreground">负责人：{department.leader}</span>}
      <div className="ml-auto flex flex-wrap gap-2"><button className="underline disabled:opacity-50" disabled={pending || index === 0} onClick={() => onMove(siblings, index, -1)}>上移</button><button className="underline disabled:opacity-50" disabled={pending || index === siblings.length - 1} onClick={() => onMove(siblings, index, 1)}>下移</button><button className="underline" onClick={() => onEdit(department)}>编辑</button><button className="underline disabled:opacity-50" disabled={pending} onClick={() => onToggle(department)}>{department.status === '0' ? '停用' : '启用'}</button><button className="text-destructive underline disabled:opacity-50" disabled={pending} onClick={() => onDelete(department)}>删除</button></div>
    </div>
    {department.children.map((child, childIndex) => <DepartmentTreeNode key={child.department_id} department={child} siblings={department.children} index={childIndex} depth={depth + 1} pending={pending} onEdit={onEdit} onMove={onMove} onToggle={onToggle} onDelete={onDelete} />)}
  </div>
}

function DepartmentEditor({ draft, departments, pending, onChange, onCancel, onSave }: {
  draft: DepartmentDraft
  departments: Department[]
  pending: boolean
  onChange: (next: DepartmentDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const set = <K extends keyof DepartmentDraft>(key: K, value: DepartmentDraft[K]) => onChange({ ...draft, [key]: value })
  const descendants = new Set<string>()
  if (draft.department_id) {
    const visit = (id: string) => departments.filter((department) => department.parent_id === id).forEach((child) => { descendants.add(child.department_id); visit(child.department_id) })
    visit(draft.department_id)
  }
  const parents = departments.filter((department) => department.status === '0' && department.department_id !== draft.department_id && !descendants.has(department.department_id))
  return <form className={`${panel} space-y-4`} onSubmit={(event) => { event.preventDefault(); onSave() }}>
    <h2 className="font-semibold">{draft.department_id ? '编辑部门' : '创建部门'}</h2>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="space-y-1 text-sm"><span>部门名称</span><input autoFocus required maxLength={30} className={input} value={draft.dept_name} onChange={(event) => set('dept_name', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span>上级部门</span><select className={input} value={draft.parent_id ?? ''} onChange={(event) => set('parent_id', event.target.value || null)}><option value="">顶级部门</option>{parents.map((department) => <option key={department.department_id} value={department.department_id}>{department.dept_name}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>排序</span><input type="number" min={0} className={input} value={draft.order_num} onChange={(event) => set('order_num', Number(event.target.value))} /></label>
      <label className="space-y-1 text-sm"><span>负责人</span><input maxLength={20} className={input} value={draft.leader} onChange={(event) => set('leader', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span>联系电话</span><input maxLength={11} className={input} value={draft.phone} onChange={(event) => set('phone', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span>邮箱</span><input type="email" maxLength={50} className={input} value={draft.email} onChange={(event) => set('email', event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span>状态</span><select className={input} value={draft.status} onChange={(event) => set('status', event.target.value as '0' | '1')}><option value="0">启用</option><option value="1">停用</option></select></label>
    </div>
    <div className="flex gap-2"><button className={primary} disabled={pending || !draft.dept_name.trim()}>{pending ? '保存中…' : '保存部门'}</button><button type="button" className={button} onClick={onCancel}>取消</button></div>
  </form>
}

function emptyDraft(): DepartmentDraft { return { dept_name: '', parent_id: null, order_num: 0, leader: '', phone: '', email: '', status: '0' } }
function toDraft(department: Department): DepartmentDraft { return { department_id: department.department_id, dept_name: department.dept_name, parent_id: department.parent_id, order_num: department.order_num, leader: department.leader ?? '', phone: department.phone ?? '', email: department.email ?? '', status: department.status } }
function flatten(departments: Department[]): Department[] { return departments.flatMap((department) => [department, ...flatten(department.children)]) }
function errorText(error: unknown) {
  if (error instanceof ApiProblem) {
    if (error.code === 'FORBIDDEN' || error.code === 'MEMBERSHIP_INACTIVE') return '当前账号没有此租户的部门管理权限。'
    if (error.code === 'DEPARTMENT_HAS_CHILDREN') return '请先删除或移动此部门下的子部门。'
    if (error.code === 'DEPARTMENT_CYCLE') return '部门父级关系不能形成循环。'
    if (error.code === 'DEPARTMENT_PARENT_INACTIVE') return '父级部门已停用，请选择其他父级。'
    if (error.code === 'DEPARTMENT_NAME_CONFLICT') return '当前租户中已有同名部门。'
    if (error.code === 'RESOURCE_NOT_FOUND') return '部门或父级不存在，或不属于当前租户。'
    return `${error.message}${error.code ? `（${error.code}）` : ''}`
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}
function ErrorBox({ message }: { message: string }) { return <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{message}</div> }
