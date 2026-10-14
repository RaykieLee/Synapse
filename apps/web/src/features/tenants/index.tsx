import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, getRouteApi, useParams } from '@tanstack/react-router'
import { LoaderCircle, Plus, RotateCcw } from 'lucide-react'
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
import { useLocale, useLocaleText } from '@/lib/i18n'
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
import { DetailDialog } from '@/components/detail-dialog'
import { LocalizedText } from '@/components/localized-text'
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

const tenantsRoute = getRouteApi('/_authenticated/tenants/')

type TenantBatchTarget = { tenant: Tenant; status: TenantStatus }
type TenantBatchFailure = TenantBatchTarget & { message: string }

function dateBoundary(value: string, nextDay = false): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day + Number(nextDay)).toISOString()
}

export function Tenants() {
  const locale = useLocale()
  const t = useLocaleText()
  const isEnglish = locale === 'en'
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
  const [lastQuery, setLastQuery] = useState(query)
  const [createOpen, setCreateOpen] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<Tenant | null>(null)
  const [batchDialog, setBatchDialog] = useState<TenantBatchTarget[] | null>(
    null
  )
  const [batchProgress, setBatchProgress] = useState<{
    completed: number
    total: number
    currentName: string
  } | null>(null)
  const [batchSummary, setBatchSummary] = useState<{
    succeeded: number
    failed: number
  } | null>(null)
  const [batchFailures, setBatchFailures] = useState<
    Record<string, TenantBatchFailure>
  >({})
  const [error, setError] = useState('')
  if (query !== lastQuery) {
    setLastQuery(query)
    setSearchInput(query)
  }
  useEffect(() => {
    if (batchProgress || searchInput.trim() === query) return
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
  }, [searchInput, query, navigate, batchProgress])
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
    request,
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
  const pageTenants = tenants.data?.items ?? []
  const hasFilters = Boolean(
    query ||
    status ||
    validity ||
    slug ||
    createdFrom ||
    createdTo ||
    updatedFrom ||
    expiresBefore
  )
  const hasOutOfRangePage = Boolean(tenants.data) && page > pages
  useEffect(() => {
    if (!hasOutOfRangePage) return
    void navigate({
      search: (previous) => ({ ...previous, page: 1 }),
      replace: true,
    })
  }, [hasOutOfRangePage, navigate])
  const listErrorMessage = tenants.isError
    ? tenants.error instanceof ApiProblem
      ? `${t('租户列表加载失败，请重试。')}${
          tenants.error.code ? ` (${tenants.error.code})` : ''
        }`
      : t('租户列表加载失败，请重试。')
    : ''
  const selectedTenants = admin
    ? pageTenants.filter(
        (tenant) =>
          selectedIds.has(tenant.tenant_id) && tenant.status !== 'archived'
      )
    : []
  const suspendTargets = selectedTenants
    .filter((tenant) => tenant.status === 'active')
    .map((tenant) => ({ tenant, status: 'suspended' as const }))
  const enableTargets = selectedTenants
    .filter((tenant) => tenant.status === 'suspended')
    .map((tenant) => ({ tenant, status: 'active' as const }))
  const retryTargets = selectedTenants.flatMap((tenant) => {
    const failure = batchFailures[tenant.tenant_id]
    return failure ? [{ tenant, status: failure.status }] : []
  })
  const visibleBatchFailures = Object.values(batchFailures).filter((failure) =>
    selectedIds.has(failure.tenant.tenant_id)
  )
  const runTenantBatch = async (targets: TenantBatchTarget[]) => {
    if (!admin || batchProgress || targets.length === 0) return
    setBatchDialog(null)
    setBatchSummary(null)
    setBatchFailures((previous) => {
      const next = { ...previous }
      for (const { tenant } of targets) delete next[tenant.tenant_id]
      return next
    })
    let completed = 0
    let succeeded = 0
    let failed = 0
    setBatchProgress({
      completed,
      total: targets.length,
      currentName: targets[0].tenant.name,
    })
    for (const target of targets) {
      setBatchProgress({
        completed,
        total: targets.length,
        currentName: target.tenant.name,
      })
      try {
        await updateTenant(target.tenant.tenant_id, { status: target.status })
        succeeded += 1
        setSelectedIds((previous) => {
          const next = new Set(previous)
          next.delete(target.tenant.tenant_id)
          return next
        })
        setBatchFailures((previous) => {
          const next = { ...previous }
          delete next[target.tenant.tenant_id]
          return next
        })
      } catch (cause) {
        failed += 1
        const message = isEnglish
          ? cause instanceof ApiProblem && cause.code
            ? `Update failed (${cause.code})`
            : 'Update failed. Retry this tenant.'
          : errorText(cause)
        setBatchFailures((previous) => ({
          ...previous,
          [target.tenant.tenant_id]: { ...target, message },
        }))
      }
      completed += 1
      setBatchProgress({
        completed,
        total: targets.length,
        currentName: target.tenant.name,
      })
    }
    setBatchProgress(null)
    setBatchSummary({ succeeded, failed })
    await refresh()
  }
  const filtersKey = JSON.stringify([
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
  ])
  const [lastFiltersKey, setLastFiltersKey] = useState(filtersKey)
  if (filtersKey !== lastFiltersKey) {
    setLastFiltersKey(filtersKey)
    setSelectedIds(new Set())
    setBatchFailures({})
    setBatchSummary(null)
  }

  return (
    <main className='space-y-5 p-6'>
      <PageHeader
        title={t('租户管理')}
        description={
          admin
            ? t(
                '平台租户目录用于管理租户状态，不代表您拥有租户内业务或成员访问权限。'
              )
            : t('查看您所属的启用租户。')
        }
        actions={
          admin ? (
            <Button
              onClick={() => {
                setError('')
                setCreateOpen(true)
              }}
            >
              <Plus className='size-4' />{' '}
              <LocalizedText text={' 创建租户\n            '} />
            </Button>
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
      {listErrorMessage ? (
        <div
          role='alert'
          className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'
        >
          <span>{listErrorMessage}</span>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void tenants.refetch()}
          >
            {t('重试')}
          </Button>
        </div>
      ) : null}
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
            disabled={Boolean(batchProgress)}
          />
          <TenantColumnOptions
            visible={visibleColumns}
            onChange={setVisibleColumns}
            isAdmin={admin}
            disabled={Boolean(batchProgress)}
          />
        </div>
        {batchProgress ? (
          <p className='text-sm text-muted-foreground'>
            {isEnglish
              ? 'Filters, column settings, and pagination are temporarily unavailable while the batch update runs.'
              : '批量更新期间，筛选、列设置和分页暂不可用。'}
          </p>
        ) : null}
        {!tenants.isError || tenants.data ? (
          <div className='overflow-hidden rounded-md border'>
            {admin &&
            (selectedIds.size > 0 ||
              batchProgress ||
              visibleBatchFailures.length > 0 ||
              batchSummary) ? (
              <div className='space-y-3 border-b bg-muted/20 px-4 py-3'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span
                    className='text-sm text-muted-foreground'
                    aria-live='polite'
                  >
                    {isEnglish
                      ? `${selectedTenants.length} selectable tenant(s) selected on this page`
                      : `当前页已选择 ${selectedTenants.length} 个可操作租户`}
                  </span>
                  {suspendTargets.length > 0 ? (
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={Boolean(batchProgress)}
                      onClick={() => setBatchDialog(suspendTargets)}
                    >
                      {isEnglish
                        ? `Suspend selected (${suspendTargets.length})`
                        : `停用所选（${suspendTargets.length}）`}
                    </Button>
                  ) : null}
                  {enableTargets.length > 0 ? (
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={Boolean(batchProgress)}
                      onClick={() => setBatchDialog(enableTargets)}
                    >
                      {isEnglish
                        ? `Enable selected (${enableTargets.length})`
                        : `启用所选（${enableTargets.length}）`}
                    </Button>
                  ) : null}
                  {visibleBatchFailures.length > 0 &&
                  retryTargets.length > 0 ? (
                    <Button
                      size='sm'
                      variant='ghost'
                      disabled={Boolean(batchProgress)}
                      onClick={() => void runTenantBatch(retryTargets)}
                    >
                      <RotateCcw className='size-4' />
                      {isEnglish
                        ? `Retry failed (${retryTargets.length})`
                        : `重试失败项（${retryTargets.length}）`}
                    </Button>
                  ) : null}
                  {batchProgress ? (
                    <span
                      className='flex items-center gap-2 text-sm text-muted-foreground'
                      role='status'
                      aria-live='polite'
                    >
                      <LoaderCircle className='size-4 animate-spin' />
                      {isEnglish
                        ? `Updating ${Math.min(batchProgress.completed + 1, batchProgress.total)}/${batchProgress.total}: ${batchProgress.currentName}`
                        : `正在更新 ${Math.min(batchProgress.completed + 1, batchProgress.total)}/${batchProgress.total}：${batchProgress.currentName}`}
                    </span>
                  ) : null}
                  {batchSummary && !batchProgress ? (
                    <span className='text-sm' role='status' aria-live='polite'>
                      {isEnglish
                        ? `Completed: ${batchSummary.succeeded} succeeded, ${batchSummary.failed} failed.`
                        : `处理完成：成功 ${batchSummary.succeeded} 项，失败 ${batchSummary.failed} 项。`}
                    </span>
                  ) : null}
                </div>
                {visibleBatchFailures.length > 0 ? (
                  <div
                    className='rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm'
                    role='alert'
                    aria-live='polite'
                  >
                    <p className='mb-1 font-medium'>
                      {isEnglish
                        ? 'Some tenant updates failed. Failed items remain selected and can be retried.'
                        : '部分租户更新失败。失败项仍保持选中，可以重试。'}
                    </p>
                    <ul className='space-y-1 text-muted-foreground'>
                      {visibleBatchFailures.map((failure) => (
                        <li key={failure.tenant.tenant_id}>
                          <span className='font-medium text-foreground'>
                            {failure.tenant.name}
                          </span>
                          {' — '}
                          {failure.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            <TenantTable
              tenants={pageTenants}
              isAdmin={admin}
              loading={tenants.isLoading}
              hasFilters={hasFilters}
              selectedIds={selectedIds}
              onSelectionChange={(ids) => {
                setSelectedIds(ids)
                setBatchSummary(null)
              }}
              selectionDisabled={Boolean(batchProgress)}
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
              disabled={Boolean(batchProgress)}
              onClearSelection={() => {
                setSelectedIds(new Set())
                setBatchSummary(null)
              }}
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
        ) : null}
      </section>
      <AlertDialog
        open={Boolean(batchDialog)}
        onOpenChange={(open) => !open && !batchProgress && setBatchDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {batchDialog?.[0]?.status === 'suspended'
                ? isEnglish
                  ? 'Suspend selected tenants?'
                  : '确认批量停用租户？'
                : isEnglish
                  ? 'Enable selected tenants?'
                  : '确认批量启用租户？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {batchDialog?.[0]?.status === 'suspended'
                ? isEnglish
                  ? 'Suspending a tenant disables access to that tenant and its Workspaces for all members. This action applies to the tenants listed below.'
                  : '停用后，该租户及其下属 Workspace 对所有成员不可访问。此操作将应用于以下租户。'
                : isEnglish
                  ? 'These tenants will become active for existing members. Workspace memberships that were separately revoked or suspended will not be restored.'
                  : '这些租户将对现有成员恢复启用。已单独撤销或停用的 Workspace 成员授权不会自动恢复。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul
            className='max-h-48 space-y-1 overflow-y-auto rounded-md border p-3 text-sm'
            aria-label={isEnglish ? 'Tenants affected' : '受影响的租户'}
          >
            {(batchDialog ?? []).slice(0, 5).map(({ tenant }) => (
              <li key={tenant.tenant_id} className='truncate'>
                {tenant.name}
              </li>
            ))}
            {(batchDialog?.length ?? 0) > 5 ? (
              <li className='pt-1 text-muted-foreground'>
                {isEnglish
                  ? `and ${batchDialog!.length - 5} more`
                  : `以及其他 ${batchDialog!.length - 5} 个租户`}
              </li>
            ) : null}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(batchProgress)}>
              {isEnglish ? 'Cancel' : '取消'}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!batchDialog?.length || Boolean(batchProgress)}
              onClick={(event) => {
                event.preventDefault()
                if (batchDialog) void runTenantBatch(batchDialog)
              }}
            >
              {batchDialog?.[0]?.status === 'suspended'
                ? isEnglish
                  ? 'Suspend tenants'
                  : '确认停用'
                : isEnglish
                  ? 'Enable tenants'
                  : '确认启用'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <LocalizedText text={'归档租户'} />
            </AlertDialogTitle>
            <AlertDialogDescription>
              <LocalizedText text={'\n              确定归档租户“'} />
              {archiveTarget?.name}
              <LocalizedText
                text={
                  '\n              ”吗？归档后租户进入终态，无法重新启用。\n            '
                }
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setArchiveTarget(null)}>
              <LocalizedText text={'\n              取消\n            '} />
            </AlertDialogCancel>
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
              <LocalizedText text={'\n              确认归档\n            '} />
            </AlertDialogAction>
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
    tenant.data?.membership_version ?? 0,
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
      <main className='p-6 text-sm text-muted-foreground'>
        <LocalizedText text={'正在加载租户…'} />
      </main>
    )
  }
  if (tenant.isError) {
    return (
      <main className='space-y-4 p-6'>
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
              onArchive={() => patchTenant.mutate({ status: 'archived' })}
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
      <DetailDialog
        trigger={<LocalizedText text={'技术信息'} />}
        title={<LocalizedText text={'租户技术信息'} />}
        description={item.name}
        triggerClassName='h-auto px-0 text-xs text-muted-foreground underline'
      >
        <div className='space-y-2 text-sm'>
          <p>
            <LocalizedText text={'租户 ID：'} />
            <code className='break-all'>{item.tenant_id}</code>
          </p>
          <Button
            size='sm'
            variant='outline'
            onClick={() => navigator.clipboard.writeText(item.tenant_id)}
          >
            <LocalizedText text={'复制 ID'} />
          </Button>
        </div>
      </DetailDialog>
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
              <CardTitle className='text-base'>
                <LocalizedText text={'快捷配置'} />
              </CardTitle>
              <CardDescription>
                <LocalizedText text={'租户级配置入口'} />
              </CardDescription>
            </CardHeader>
            <CardContent className='grid gap-1 text-sm'>
              {managementLinks.map((link) => (
                <a
                  key={link.to}
                  href={link.to}
                  className='flex items-center justify-between rounded-md px-3 py-2 transition-colors hover:bg-muted'
                >
                  {link.label}
                  <span aria-hidden='true'>
                    <LocalizedText text={'→'} />
                  </span>
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
              <h2 className='text-lg font-semibold'>
                <LocalizedText text={'租户成员'} />
              </h2>
              <p className='mt-1 text-sm text-muted-foreground'>
                <LocalizedText
                  text={
                    '\n                通过邮箱邀请已有账号加入。接受邀请后不会自动加入任何 Workspace。\n              '
                  }
                />
              </p>
            </div>
          </div>
          <MemberTable
            members={members.data?.items ?? []}
            canManage={canManage}
            currentRole={item.tenant_role}
            loading={members.isLoading}
            mutationPending={patchMember.isPending}
            mutationError={
              patchMember.isError ? errorText(patchMember.error) : ''
            }
            onRoleChange={(member, role) =>
              patchMember.mutateAsync({
                userId: member.user_id,
                body: { tenant_role: role },
              })
            }
            onStatusChange={(member, status) =>
              patchMember.mutateAsync({
                userId: member.user_id,
                body: { status },
              })
            }
            onRemove={(member) =>
              patchMember.mutateAsync({
                userId: member.user_id,
                body: { status: 'removed' },
              })
            }
            onReactivate={(member) =>
              patchMember.mutateAsync({
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
            <h2 className='text-lg font-semibold'>
              <LocalizedText text={'邀请链接'} />
            </h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              <LocalizedText
                text={
                  '\n              收件人使用已有 Synapse\n              账号登录后接受邀请。租户管理员只能邀请为成员。\n            '
                }
              />
            </p>
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
