import { useEffect, useState } from 'react'
import { formatMessage } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, getRouteApi, useParams } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import {
  createTenantInvitation,
  listTenantInvitations,
  revokeTenantInvitation,
  type CreatedTenantInvitation,
  type TenantInvitationCreatePayload,
} from '@/api/tenant-invitations'
import {
  createTenant,
  getTenant,
  listPlatformTenants,
  listTenantMembers,
  listTenants,
  updateTenant,
  updateTenantMember,
  type Page,
  type Tenant,
  type TenantPatchPayload,
  type TenantStatus,
  type TenantValidity,
} from '@/api/tenants'
import { useAuthStore } from '@/stores/auth-store'
import { ApiProblem, api } from '@/lib/api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { CreateTenantDialog } from './components/create-tenant-dialog'
import { InvitationPanel } from './components/invitation-panel'
import { MemberCustomRoleCell } from './components/member-custom-role'
import { MemberTable } from './components/member-table'
import { ErrorBox, PageHeader, panelClass } from './components/shared'
import {
  EditTenantNameDialog,
  EditTenantValidityDialog,
  TenantStatusActions,
} from './components/tenant-actions'
import { TenantSummaryCard } from './components/tenant-summary'
import {
  TablePager,
  TenantTable,
  TenantToolbar,
  TenantColumnOptions,
  tenantColumns,
  type TenantColumn,
} from './components/tenant-table'
import { tenantText, type TenantRoleRecord } from './types'
import { LocalizedText } from '@/components/localized-text'

const tenantsRoute = getRouteApi('/_authenticated/tenants/')

function dateBoundary(value: string, nextDay = false): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day + Number(nextDay)).toISOString()
}

export function Tenants() {
  const actor = useAuthStore((s) => s.auth.user)
  const admin = actor?.platform_role === 'platform_admin'
  const search = tenantsRoute.useSearch()
  const navigate = tenantsRoute.useNavigate()
  const page = search.page ?? 1
  const pageSize = search.pageSize ?? 20
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [visibleColumns, setVisibleColumns] = useState<Set<TenantColumn>>(
    () => new Set(tenantColumns.map((column) => column.key))
  )
  const query = search.q ?? ''
  const status = admin ? (search.status ?? '') : ''
  const validity = search.validity ?? ''
  const slug = search.slug ?? ''
  const createdFrom = search.createdFrom ?? ''
  const createdTo = search.createdTo ?? ''
  const updatedFrom = search.updatedFrom ?? ''
  const expiresBefore = search.expiresBefore ?? ''
  const [searchInput, setSearchInput] = useState(query)
  useEffect(() => setSearchInput(query), [query])
  useEffect(() => {
    if (searchInput.trim() === query) return
    const timer = window.setTimeout(() => {
      void navigate({
        search: (previous) => ({
          ...previous,
          q: searchInput.trim() || undefined,
          page: 1,
        }),
        replace: true,
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput, query, navigate])
  const [createOpen, setCreateOpen] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<Tenant | null>(null)
  const [error, setError] = useState('')
  const client = useQueryClient()
  const request = {
    page,
    pageSize,
    q: query || undefined,
    status: status || undefined,
    validity: validity || undefined,
    slug: slug || undefined,
    createdFrom: createdFrom ? dateBoundary(createdFrom) : undefined,
    createdTo: createdTo ? dateBoundary(createdTo, true) : undefined,
    updatedFrom: updatedFrom ? dateBoundary(updatedFrom) : undefined,
    expiresBefore: expiresBefore
      ? dateBoundary(expiresBefore, true)
      : undefined,
  }
  const key = [
    'synapse',
    actor?.user_id ?? 'anonymous',
    'global',
    'personal',
    'tenants',
    admin ? 'platform' : 'member',
    page,
    pageSize,
    query,
    status,
    validity,
    slug,
    createdFrom,
    createdTo,
    updatedFrom,
    expiresBefore,
  ]
  const tenants = useQuery({
    queryKey: key,
    queryFn: () =>
      admin ? listPlatformTenants(request) : listTenants(request),
  })
  const refresh = async () => {
    await client.invalidateQueries({
      queryKey: [
        'synapse',
        actor?.user_id ?? 'anonymous',
        'global',
        'personal',
        'tenants',
      ],
    })
  }
  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: TenantPatchPayload }) =>
      updateTenant(id, body),
    onSuccess: refresh,
    onError: (cause) => setError(errorText(cause)),
  })
  const create = useMutation({
    mutationFn: createTenant,
    onSuccess: async () => {
      setError('')
      setCreateOpen(false)
      await refresh()
      void navigate({ search: (previous) => ({ ...previous, page: 1 }) })
    },
    onError: (cause) => setError(errorText(cause)),
  })

  const total = tenants.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  useEffect(
    () => setSelectedIds(new Set()),
    [
      page,
      pageSize,
      query,
      status,
      validity,
      slug,
      createdFrom,
      createdTo,
      updatedFrom,
      expiresBefore,
    ]
  )

  return (
    <main className='space-y-5 p-6'>
      <PageHeader
        title='租户管理'
        description={
          admin ? "平台租户目录用于管理租户状态，不代表您拥有租户内业务或成员访问权限。" : "查看您所属的启用租户。"
        }
        actions={
          admin ? (
            <Button
              onClick={() => {
                setError('')
                setCreateOpen(true)
              }}
            >
              <Plus className='size-4' /> <LocalizedText text={" 创建租户\n            "} /></Button>
          ) : null
        }
      />
      {admin ? (
        <CreateTenantDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          pending={create.isPending}
          onSubmit={(payload) => create.mutate(payload)}
        />
      ) : null}
      {error ? <ErrorBox message={error} /> : null}
      <section className='space-y-4'>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <TenantToolbar
            query={searchInput}
            onQueryChange={setSearchInput}
            status={status}
            onStatusChange={(value: TenantStatus | '') =>
              void navigate({
                search: (previous) => ({
                  ...previous,
                  status: value || undefined,
                  page: 1,
                }),
              })
            }
            validity={validity}
            onValidityChange={(value: TenantValidity | '') =>
              void navigate({
                search: (previous) => ({
                  ...previous,
                  validity: value || undefined,
                  page: 1,
                }),
              })
            }
            createdFrom={createdFrom}
            createdTo={createdTo}
            slug={slug}
            updatedFrom={updatedFrom}
            expiresBefore={expiresBefore}
            onAdvancedChange={(values) =>
              void navigate({
                search: (previous) => ({
                  ...previous,
                  slug: values.slug || undefined,
                  createdFrom: values.createdFrom || undefined,
                  createdTo: values.createdTo || undefined,
                  updatedFrom: values.updatedFrom || undefined,
                  expiresBefore: values.expiresBefore || undefined,
                  page: 1,
                }),
              })
            }
            onReset={() => {
              setSearchInput('')
              void navigate({ search: () => ({ page: 1 }), replace: true })
            }}
            isAdmin={admin}
          />
          <TenantColumnOptions
            visible={visibleColumns}
            onChange={setVisibleColumns}
            isAdmin={admin}
          />
        </div>
        <div className='overflow-hidden rounded-md border'>
          <TenantTable
            tenants={tenants.data?.items ?? []}
            isAdmin={admin}
            loading={tenants.isLoading}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            visibleColumns={visibleColumns}
            onStatusChange={(tenant) =>
              mutation.mutate({
                id: tenant.tenant_id,
                body: {
                  status: tenant.status === 'active' ? 'suspended' : 'active',
                },
              })
            }
            onArchive={setArchiveTarget}
          />
          <TablePager
            page={page}
            pages={pages}
            total={total}
            pageSize={pageSize}
            selectedCount={selectedIds.size}
            onClearSelection={() => setSelectedIds(new Set())}
            onPageChange={(nextPage) =>
              void navigate({
                search: (previous) => ({ ...previous, page: nextPage }),
              })
            }
            onPageSizeChange={(size) =>
              void navigate({
                search: (previous) => ({
                  ...previous,
                  pageSize: size as 10 | 20 | 30 | 50,
                  page: 1,
                }),
              })
            }
          />
        </div>
      </section>
      <AlertDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle><LocalizedText text={"归档租户"} /></AlertDialogTitle>
            <AlertDialogDescription>
              <LocalizedText text={"\n              确定归档租户“"} />{archiveTarget?.name}
              <LocalizedText text={"\n              ”吗？归档后租户进入终态，无法重新启用。\n            "} /></AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setArchiveTarget(null)}>
              <LocalizedText text={"\n              取消\n            "} /></AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (archiveTarget)
                  mutation.mutate({
                    id: archiveTarget.tenant_id,
                    body: { status: 'archived' },
                  })
                setArchiveTarget(null)
              }}
            >
              <LocalizedText text={"\n              确认归档\n            "} /></AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

export function TenantDetail() {
  const actor = useAuthStore((s) => s.auth.user)
  const platformAdmin = actor?.platform_role === 'platform_admin'
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId' })
  const client = useQueryClient()
  const [error, setError] = useState('')
  const [memberPage, setMemberPage] = useState(1)
  const tenantKey = [
    'synapse',
    actor?.user_id ?? 'anonymous',
    tenantId,
    'personal',
    'tenant',
  ]
  const tenant = useQuery({
    queryKey: tenantKey,
    queryFn: () => getTenant(tenantId),
  })
  const canManage =
    tenant.data?.tenant_role === 'owner' || tenant.data?.tenant_role === 'admin'
  const canManageStatus = platformAdmin
  const membersKey = [
    'synapse',
    actor?.user_id ?? 'anonymous',
    tenantId,
    'personal',
    'tenant-members',
    tenant.data?.membership_version ?? 0,
    memberPage,
    20,
  ]
  const members = useQuery({
    queryKey: membersKey,
    enabled: canManage || tenant.data?.tenant_role === 'member',
    queryFn: () =>
      listTenantMembers(tenantId, { page: memberPage, pageSize: 20 }),
  })
  const rolesKey = [
    'synapse',
    actor?.user_id ?? 'anonymous',
    tenantId,
    'tenant',
    'roles',
    'active-assignment-options',
  ]
  const activeRoles = useQuery({
    queryKey: rolesKey,
    enabled: canManage,
    queryFn: () =>
      api<Page<TenantRoleRecord>>(
        `/tenants/${tenantId}/roles?page=1&page_size=100&status=active`
      ),
  })
  const invitationKey = [
    'synapse',
    actor?.user_id ?? 'anonymous',
    tenantId,
    'personal',
    'tenant-invitations',
  ]
  const invitations = useQuery({
    queryKey: invitationKey,
    enabled: canManage,
    queryFn: () => listTenantInvitations(tenantId),
  })
  const [createdInvite, setCreatedInvite] =
    useState<CreatedTenantInvitation | null>(null)
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: tenantKey })
    await client.invalidateQueries({
      queryKey: [
        'synapse',
        actor?.user_id ?? 'anonymous',
        tenantId,
        'personal',
        'tenant-members',
      ],
    })
  }
  const patchTenant = useMutation({
    mutationFn: (body: TenantPatchPayload) => updateTenant(tenantId, body),
    onSuccess: refresh,
    onError: (cause) => setError(errorText(cause)),
  })
  const patchMember = useMutation({
    mutationFn: ({
      userId,
      body,
    }: {
      userId: string
      body: Parameters<typeof updateTenantMember>[2]
    }) => updateTenantMember(tenantId, userId, body),
    onSuccess: refresh,
    onError: (cause) => setError(errorText(cause)),
  })
  const createInvite = useMutation({
    mutationFn: (body: TenantInvitationCreatePayload) =>
      createTenantInvitation(tenantId, body),
    onSuccess: async (invite) => {
      setCreatedInvite(invite)
      setError('')
      await client.invalidateQueries({ queryKey: invitationKey })
    },
    onError: (cause) => setError(errorText(cause)),
  })
  const revokeInvite = useMutation({
    mutationFn: (invitationId: string) =>
      revokeTenantInvitation(tenantId, invitationId),
    onSuccess: async () => {
      setError('')
      await client.invalidateQueries({ queryKey: invitationKey })
    },
    onError: (cause) => setError(errorText(cause)),
  })
  if (tenant.isLoading) {
    return (
      <main className='p-6 text-sm text-muted-foreground'><LocalizedText text={"正在加载租户…"} /></main>
    )
  }
  if (tenant.isError) {
    return (
      <main className='space-y-4 p-6'>
        <Link to='/tenants' className='text-sm underline'>
          <LocalizedText text={"\n          返回租户列表\n        "} /></Link>
        <ErrorBox message={errorText(tenant.error)} />
      </main>
    )
  }
  const item = tenant.data!
  const managementLinks = [
    { to: `/tenants/${tenantId}/roles`, label: '角色管理' },
    { to: `/tenants/${tenantId}/menus`, label: '菜单管理' },
    { to: `/tenants/${tenantId}/departments`, label: '部门管理' },
    { to: `/tenants/${tenantId}/dictionaries`, label: '字典管理' },
    { to: `/tenants/${tenantId}/configs`, label: '参数配置' },
    { to: `/tenants/${tenantId}/scheduled-tasks`, label: '系统任务' },
  ]

  return (
    <main className='space-y-5 p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <Link
          to='/tenants'
          className='text-sm text-muted-foreground hover:text-foreground'
        >
          <LocalizedText text={"\n          ← 返回租户列表\n        "} /></Link>
        <div className='flex flex-wrap items-center gap-2'>
          {canManage || platformAdmin ? (
            <EditTenantNameDialog
              tenant={item}
              onSave={(name) => patchTenant.mutate({ name })}
            />
          ) : null}
          {canManage || platformAdmin ? (
            <EditTenantValidityDialog
              tenant={item}
              onSave={(payload) => patchTenant.mutate(payload)}
            />
          ) : null}
          {canManageStatus ? (
            <TenantStatusActions
              tenant={item}
              onChange={(status) => patchTenant.mutate({ status })}
              onArchive={() => {
                if (window.confirm(formatMessage('确定归档租户“{name}”吗？', { name: item.name }))) {
                  patchTenant.mutate({ status: 'archived' })
                }
              }}
            />
          ) : null}
        </div>
      </div>
      <PageHeader
        title={item.name}
        description={`${tenantText[item.status]}${
          item.tenant_role
            ? ` · 我的角色：${tenantText[item.tenant_role]}`
            : platformAdmin
              ? ' · 平台管理视图'
              : ''
        }`}
        actions={
          canManage && item.status === 'active' ? (
            <>
              {[
                { path: '/tenants/$tenantId/roles', label: '角色管理' },
                { path: '/tenants/$tenantId/menus', label: '菜单管理' },
                { path: '/tenants/$tenantId/departments', label: '部门管理' },
              ].map((link) => (
                <Button key={link.path} asChild variant='outline' size='sm'>
                  <Link to={link.path} params={{ tenantId }}>
                    {link.label}
                  </Link>
                </Button>
              ))}
            </>
          ) : null
        }
      />
      <details className='text-xs text-muted-foreground'>
        <summary className='w-fit cursor-pointer'><LocalizedText text={"技术信息"} /></summary>
        <div className='mt-2 flex flex-wrap items-center gap-2'>
          <code>租户 ID {item.tenant_id}</code>
          <button
            type='button'
            className='underline'
            onClick={() => navigator.clipboard.writeText(item.tenant_id)}
          >
            <LocalizedText text={"\n            复制 ID\n          "} /></button>
        </div>
      </details>
      <section className='grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]'>
        <TenantSummaryCard
          tenant={item}
          roleText={
            item.tenant_role
              ? `${tenantText[item.tenant_role]}视图`
              : platformAdmin
                ? '平台管理视图'
                : undefined
          }
        />
        {canManage && item.status === 'active' ? (
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-base'><LocalizedText text={"快捷配置"} /></CardTitle>
              <CardDescription><LocalizedText text={"租户级配置入口"} /></CardDescription>
            </CardHeader>
            <CardContent className='grid gap-1 text-sm'>
              {managementLinks.map((link) => (
                <a
                  key={link.to}
                  href={link.to}
                  className='flex items-center justify-between rounded-md px-3 py-2 transition-colors hover:bg-muted'
                >
                  {link.label}
                  <span aria-hidden='true'><LocalizedText text={"→"} /></span>
                </a>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </section>
      {error ? <ErrorBox message={error} /> : null}
      {canManage || item.tenant_role === 'member' ? (
        <section className={panelClass}>
          <div className='flex flex-wrap items-center justify-between gap-3 p-5 pb-4'>
            <div>
              <h2 className='text-lg font-semibold'><LocalizedText text={"租户成员"} /></h2>
              <p className='mt-1 text-sm text-muted-foreground'>
                <LocalizedText text={"\n                通过邮箱邀请已有账号加入。接受邀请后不会自动加入任何 Workspace。\n              "} /></p>
            </div>
          </div>
          <MemberTable
            members={members.data?.items ?? []}
            canManage={canManage}
            currentRole={item.tenant_role}
            loading={members.isLoading}
            onRoleChange={(member, role) =>
              patchMember.mutate({
                userId: member.user_id,
                body: { tenant_role: role },
              })
            }
            onStatusChange={(member, status) =>
              patchMember.mutate({ userId: member.user_id, body: { status } })
            }
            onRemove={(member) =>
              patchMember.mutate({
                userId: member.user_id,
                body: { status: 'removed' },
              })
            }
            onReactivate={(member) =>
              patchMember.mutate({
                userId: member.user_id,
                body: { status: 'active' },
              })
            }
            renderCustomRole={(member) => (
              <MemberCustomRoleCell
                tenantId={tenantId}
                actorId={actor?.user_id ?? 'anonymous'}
                member={member}
                roles={activeRoles.data?.items ?? []}
                rolesLoading={activeRoles.isLoading}
                rolesError={
                  activeRoles.isError ? errorText(activeRoles.error) : undefined
                }
                membershipVersion={item.membership_version}
                canManage={canManage}
                onError={setError}
              />
            )}
          />
          <TablePager
            page={memberPage}
            pages={Math.max(1, Math.ceil((members.data?.total ?? 0) / 20))}
            total={members.data?.total ?? 0}
            pageSize={20}
            onPageChange={setMemberPage}
          />
        </section>
      ) : null}
      {canManage && item.status === 'active' ? (
        <section className={panelClass}>
          <div className='p-5 pb-4'>
            <h2 className='text-lg font-semibold'><LocalizedText text={"邀请链接"} /></h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              <LocalizedText text={"\n              收件人使用已有 Synapse\n              账号登录后接受邀请。租户管理员只能邀请为成员。\n            "} /></p>
          </div>
          <div className='px-5 pb-5'>
            <InvitationPanel
              pending={createInvite.isPending}
              created={createdInvite}
              invitations={invitations.data?.items ?? []}
              loading={invitations.isLoading}
              canInviteAdmin={item.tenant_role === 'owner'}
              onCreate={(payload) => createInvite.mutate(payload)}
              onRevoke={(invitation) =>
                revokeInvite.mutate(invitation.invitation_id)
              }
            />
          </div>
        </section>
      ) : null}
    </main>
  )
}

function errorText(e: unknown) {
  if (e instanceof ApiProblem)
    return `${e.message}${e.code ? `（${e.code}）` : ''}`
  return e instanceof Error ? e.message : '操作失败，请稍后重试。'
}
