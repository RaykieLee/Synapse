import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import {
  createTenantDepartment,
  deleteTenantDepartment,
  getTenantDepartmentTree,
  reorderTenantDepartments,
  updateTenantDepartment,
  type Department,
  type DepartmentOrder,
  type DepartmentPayload,
} from '@/api/tenant-departments'
import { getTenant } from '@/api/tenants'
import { useAuthStore } from '@/stores/auth-store'
import { ApiProblem } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { FormDialog } from '@/components/form-dialog'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { LocalizedText } from '@/components/localized-text'

type DepartmentDraft = DepartmentPayload & { department_id?: string }

const panel = 'rounded-lg border bg-card p-5 shadow-sm'
const input = 'h-10 w-full rounded-md border bg-background px-3 text-sm'
const primary =
  'rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50'

export function TenantDepartmentsPage() {
  const actor = useAuthStore((state) => state.auth.user)
  const { tenantId } = useParams({
    from: '/_authenticated/tenants/$tenantId/departments',
  })
  const client = useQueryClient()
  const [draft, setDraft] = useState<DepartmentDraft | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Department | null>(null)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const actorId = actor?.user_id ?? 'anonymous'
  const tenantKey = ['synapse', actorId, tenantId, 'personal', 'tenant']
  const tenant = useQuery({
    queryKey: tenantKey,
    queryFn: () => getTenant(tenantId),
  })
  const canManage =
    tenant.data?.tenant_role === 'owner' || tenant.data?.tenant_role === 'admin'
  const treeKey = [
    'synapse',
    actorId,
    tenantId,
    'tenant',
    'departments',
    'tree',
  ]
  const tree = useQuery({
    queryKey: treeKey,
    enabled: canManage,
    queryFn: () => getTenantDepartmentTree(tenantId),
  })
  const invalidate = async () => {
    await client.invalidateQueries({
      queryKey: ['synapse', actorId, tenantId, 'tenant', 'departments'],
    })
    await client.invalidateQueries({ queryKey: tenantKey })
  }
  const save = useMutation({
    mutationFn: (value: DepartmentDraft) => {
      const { department_id, ...body } = value
      return department_id
        ? updateTenantDepartment(tenantId, department_id, body)
        : createTenantDepartment(tenantId, body)
    },
    onSuccess: async () => {
      setDraft(null)
      setSaveError('')
      setError('')
      await invalidate()
    },
    onError: (cause) => setSaveError(errorText(cause)),
  })
  const reorder = useMutation({
    mutationFn: (items: DepartmentOrder[]) =>
      reorderTenantDepartments(tenantId, items),
    onSuccess: async () => {
      setError('')
      await invalidate()
    },
    onError: (cause) => setError(errorText(cause)),
  })
  const toggle = useMutation({
    mutationFn: ({
      departmentId,
      status,
    }: {
      departmentId: string
      status: '0' | '1'
    }) => updateTenantDepartment(tenantId, departmentId, { status }),
    onSuccess: async () => {
      setError('')
      await invalidate()
    },
    onError: (cause) => setError(errorText(cause)),
  })
  const remove = useMutation({
    mutationFn: (departmentId: string) =>
      deleteTenantDepartment(tenantId, departmentId),
    onSuccess: async () => {
      setRemoveTarget(null)
      setError('')
      await invalidate()
    },
    onError: (cause) => {
      setRemoveTarget(null)
      setError(errorText(cause))
    },
  })

  if (tenant.isLoading)
    return (
      <main className='p-6'>
        <LocalizedText text={'正在加载租户…'} />
      </main>
    )
  if (tenant.isError)
    return (
      <main className='space-y-4 p-6'>
        <ErrorBox message={errorText(tenant.error)} />
      </main>
    )
  if (!canManage)
    return (
      <main className='space-y-4 p-6'>
        <ErrorBox message='仅租户所有者或管理员可以管理部门。' />
      </main>
    )

  const departments = tree.data?.items ?? []
  const flat = flatten(departments)
  const moveSibling = (
    siblings: Department[],
    index: number,
    delta: -1 | 1
  ) => {
    const next = index + delta
    if (next < 0 || next >= siblings.length) return
    const ordered = [...siblings]
    ;[ordered[index], ordered[next]] = [ordered[next], ordered[index]]
    reorder.mutate(
      ordered.map((department, order) => ({
        department_id: department.department_id,
        parent_id: department.parent_id,
        order_num: (order + 1) * 10,
      }))
    )
  }

  return (
    <main className='space-y-5 p-6'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold'>
            <LocalizedText text={'租户部门'} />
          </h1>
          <p className='mt-1 max-w-2xl text-sm text-muted-foreground'>
            <LocalizedText
              text={
                '管理当前租户的部门层级、排序和状态。部门不会自动关联租户成员。'
              }
            />
          </p>
        </div>
        <button
          className={primary}
          onClick={() => {
            setError('')
            setSaveError('')
            setDraft(emptyDraft())
          }}
        >
          <LocalizedText text={'创建部门'} />
        </button>
      </header>
      {error && <ErrorBox message={error} />}
      {draft && (
        <DepartmentEditor
          draft={draft}
          departments={flat}
          pending={save.isPending}
          error={saveError}
          onChange={setDraft}
          onCancel={() => {
            setDraft(null)
            setSaveError('')
          }}
          onSave={() => save.mutate(draft)}
        />
      )}
      <section className={`${panel} space-y-4`}>
        <div>
          <h2 className='font-semibold'>
            <LocalizedText text={'部门树'} />
          </h2>
          <p className='text-sm text-muted-foreground'>
            <LocalizedText
              text={
                '上移或下移调整同级顺序；编辑部门可移动到其他有效父级。停用部门会保留在树中。'
              }
            />
          </p>
        </div>
        {tree.isLoading ? (
          <p className='py-6 text-center text-sm text-muted-foreground'>
            <LocalizedText text={'正在加载部门…'} />
          </p>
        ) : tree.isError ? (
          <ErrorBox message={errorText(tree.error)} />
        ) : departments.length ? (
          <div className='space-y-2'>
            {departments.map((department, index) => (
              <DepartmentTreeNode
                key={department.department_id}
                department={department}
                siblings={departments}
                index={index}
                depth={0}
                pending={
                  reorder.isPending || toggle.isPending || remove.isPending
                }
                onEdit={(value) => {
                  setError('')
                  setSaveError('')
                  setDraft(toDraft(value))
                }}
                onMove={moveSibling}
                onToggle={(value) =>
                  toggle.mutate({
                    departmentId: value.department_id,
                    status: value.status === '0' ? '1' : '0',
                  })
                }
                onDelete={setRemoveTarget}
              />
            ))}
          </div>
        ) : (
          <p className='py-8 text-center text-sm text-muted-foreground'>
            <LocalizedText text={'暂无部门'} />
          </p>
        )}
      </section>
      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoveTarget(null)
        }}
        title='删除部门'
        desc='有子部门时服务端会拒绝删除。删除后不能恢复。'
        confirmText='确认删除'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (removeTarget) remove.mutate(removeTarget.department_id)
        }}
      >
        {removeTarget && (
          <p className='text-sm font-medium'>{removeTarget.dept_name}</p>
        )}
      </ConfirmDialog>
    </main>
  )
}

function DepartmentTreeNode({
  department,
  siblings,
  index,
  depth,
  pending,
  onEdit,
  onMove,
  onToggle,
  onDelete,
}: {
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
  return (
    <div>
      <div
        className='flex flex-wrap items-center gap-2 rounded-md border p-3'
        style={{ marginLeft: `${depth * 1.25}rem` }}
      >
        <span className='min-w-32 font-medium'>{department.dept_name}</span>
        <span className='text-xs text-muted-foreground'>
          {department.status === '0' ? (
            <LocalizedText text={'启用'} />
          ) : (
            <LocalizedText text={'停用'} />
          )}{' '}
          <LocalizedText text={' · 顺序 '} />
          {department.order_num}
        </span>
        {department.leader && (
          <span className='text-xs text-muted-foreground'>
            <LocalizedText text={'负责人：'} />
            {department.leader}
          </span>
        )}
        <div className='ml-auto flex flex-wrap gap-2'>
          <button
            className='underline disabled:opacity-50'
            disabled={pending || index === 0}
            onClick={() => onMove(siblings, index, -1)}
          >
            <LocalizedText text={'上移'} />
          </button>
          <button
            className='underline disabled:opacity-50'
            disabled={pending || index === siblings.length - 1}
            onClick={() => onMove(siblings, index, 1)}
          >
            <LocalizedText text={'下移'} />
          </button>
          <button className='underline' onClick={() => onEdit(department)}>
            <LocalizedText text={'编辑'} />
          </button>
          <button
            className='underline disabled:opacity-50'
            disabled={pending}
            onClick={() => onToggle(department)}
          >
            {department.status === '0' ? (
              <LocalizedText text={'停用'} />
            ) : (
              <LocalizedText text={'启用'} />
            )}
          </button>
          <button
            className='text-destructive underline disabled:opacity-50'
            disabled={pending}
            onClick={() => onDelete(department)}
          >
            <LocalizedText text={'删除'} />
          </button>
        </div>
      </div>
      {department.children.map((child, childIndex) => (
        <DepartmentTreeNode
          key={child.department_id}
          department={child}
          siblings={department.children}
          index={childIndex}
          depth={depth + 1}
          pending={pending}
          onEdit={onEdit}
          onMove={onMove}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}

function DepartmentEditor({
  draft,
  departments,
  pending,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  draft: DepartmentDraft
  departments: Department[]
  pending: boolean
  error: string
  onChange: (next: DepartmentDraft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const set = <K extends keyof DepartmentDraft>(
    key: K,
    value: DepartmentDraft[K]
  ) => onChange({ ...draft, [key]: value })
  const descendants = new Set<string>()
  if (draft.department_id) {
    const visit = (id: string) =>
      departments
        .filter((department) => department.parent_id === id)
        .forEach((child) => {
          descendants.add(child.department_id)
          visit(child.department_id)
        })
    visit(draft.department_id)
  }
  const parents = departments.filter(
    (department) =>
      department.status === '0' &&
      department.department_id !== draft.department_id &&
      !descendants.has(department.department_id)
  )
  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={
        draft.department_id ? (
          <LocalizedText text={'编辑部门'} />
        ) : (
          <LocalizedText text={'创建部门'} />
        )
      }
      formAriaLabel={draft.department_id ? '编辑部门' : '创建部门'}
      description='配置部门层级、负责人信息和启用状态。'
      error={error}
      submitLabel={
        draft.department_id ? (
          <LocalizedText text={'保存部门'} />
        ) : (
          <LocalizedText text={'创建部门'} />
        )
      }
      pending={pending}
      disabled={!draft.dept_name.trim()}
      onSubmit={onSave}
      onCancel={onCancel}
    >
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        <label className='space-y-1 text-sm'>
          <span>
            <LocalizedText text={'部门名称'} />
          </span>
          <Input
            autoFocus
            required
            maxLength={30}
            className={input}
            value={draft.dept_name}
            onChange={(event) => set('dept_name', event.target.value)}
          />
        </label>
        <label className='space-y-1 text-sm'>
          <span>
            <LocalizedText text={'上级部门'} />
          </span>
          <LocalizedNativeSelect
            className={input}
            value={draft.parent_id ?? ''}
            onChange={(event) => set('parent_id', event.target.value || null)}
          >
            <option value=''>
              <LocalizedText text={'顶级部门'} />
            </option>
            {parents.map((department) => (
              <option
                key={department.department_id}
                value={department.department_id}
              >
                {department.dept_name}
              </option>
            ))}
          </LocalizedNativeSelect>
        </label>
        <label className='space-y-1 text-sm'>
          <span>
            <LocalizedText text={'排序'} />
          </span>
          <Input
            type='number'
            min={0}
            className={input}
            value={draft.order_num}
            onChange={(event) => set('order_num', Number(event.target.value))}
          />
        </label>
        <label className='space-y-1 text-sm'>
          <span>
            <LocalizedText text={'负责人'} />
          </span>
          <Input
            maxLength={20}
            className={input}
            value={draft.leader}
            onChange={(event) => set('leader', event.target.value)}
          />
        </label>
        <label className='space-y-1 text-sm'>
          <span>
            <LocalizedText text={'联系电话'} />
          </span>
          <Input
            maxLength={11}
            className={input}
            value={draft.phone}
            onChange={(event) => set('phone', event.target.value)}
          />
        </label>
        <label className='space-y-1 text-sm'>
          <span>
            <LocalizedText text={'邮箱'} />
          </span>
          <Input
            type='email'
            maxLength={50}
            className={input}
            value={draft.email}
            onChange={(event) => set('email', event.target.value)}
          />
        </label>
        <label className='space-y-1 text-sm'>
          <span>
            <LocalizedText text={'状态'} />
          </span>
          <LocalizedNativeSelect
            className={input}
            value={draft.status}
            onChange={(event) => set('status', event.target.value as '0' | '1')}
          >
            <option value='0'>
              <LocalizedText text={'启用'} />
            </option>
            <option value='1'>
              <LocalizedText text={'停用'} />
            </option>
          </LocalizedNativeSelect>
        </label>
      </div>
    </FormDialog>
  )
}

function emptyDraft(): DepartmentDraft {
  return {
    dept_name: '',
    parent_id: null,
    order_num: 0,
    leader: '',
    phone: '',
    email: '',
    status: '0',
  }
}
function toDraft(department: Department): DepartmentDraft {
  return {
    department_id: department.department_id,
    dept_name: department.dept_name,
    parent_id: department.parent_id,
    order_num: department.order_num,
    leader: department.leader ?? '',
    phone: department.phone ?? '',
    email: department.email ?? '',
    status: department.status,
  }
}
function flatten(departments: Department[]): Department[] {
  return departments.flatMap((department) => [
    department,
    ...flatten(department.children),
  ])
}
function errorText(error: unknown) {
  if (error instanceof ApiProblem) {
    if (error.code === 'FORBIDDEN' || error.code === 'MEMBERSHIP_INACTIVE')
      return '当前账号没有此租户的部门管理权限。'
    if (error.code === 'DEPARTMENT_HAS_CHILDREN')
      return '请先删除或移动此部门下的子部门。'
    if (error.code === 'DEPARTMENT_CYCLE') return '部门父级关系不能形成循环。'
    if (error.code === 'DEPARTMENT_PARENT_INACTIVE')
      return '父级部门已停用，请选择其他父级。'
    if (error.code === 'DEPARTMENT_NAME_CONFLICT')
      return '当前租户中已有同名部门。'
    if (error.code === 'RESOURCE_NOT_FOUND')
      return '部门或父级不存在，或不属于当前租户。'
    return `${error.message}${error.code ? `（${error.code}）` : ''}`
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}
function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role='alert'
      className='rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'
    >
      {message}
    </div>
  )
}
