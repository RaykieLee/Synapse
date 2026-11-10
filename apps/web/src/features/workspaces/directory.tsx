import * as React from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Check, ChevronsUpDown, Plus, Layers3, X } from 'lucide-react'
import { createWorkspace, listAllWorkspaces } from '@/api/workspaces'
import { useAuthStore } from '@/stores/auth-store'
import { ApiProblem, api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  roleLabel,
  type Page,
  type TenantSummary,
  type Workspace,
} from './types'
import { LocalizedText } from '@/components/localized-text'
import { useLocale, useLocaleText } from '@/lib/i18n'
import {
  workspaceRecoveryCopy,
  workspaceRecoveryReason,
} from './workspace-recovery-messages'

const workspacePath = (id: string) => `/w/${id}`
const recentKey = (userId: string) => `synapse:recent-workspace:${userId}`

export function readRecentWorkspace(userId: string): Workspace | null {
  try {
    const value = window.localStorage.getItem(recentKey(userId))
    return value ? (JSON.parse(value) as Workspace) : null
  } catch {
    return null
  }
}

export function saveRecentWorkspace(userId: string, workspace: Workspace) {
  window.localStorage.setItem(recentKey(userId), JSON.stringify(workspace))
}

export function useWorkspaceDirectory(includeArchived = true) {
  const actor = useAuthStore((state) => state.auth.user)
  const actorId = actor?.user_id ?? 'anonymous'
  const tenantQuery = useQuery({
    queryKey: [
      'synapse',
      actorId,
      'global',
      'personal',
      'tenant-directory',
      1,
      100,
    ],
    queryFn: () => loadAllPages<TenantSummary>('/tenants'),
    enabled: Boolean(actor),
  })
  const workspaceQuery = useQuery({
    queryKey: [
      'synapse',
      actorId,
      'global',
      'personal',
      'workspace-directory',
      includeArchived,
      1,
      100,
    ],
    queryFn: () => listAllWorkspaces(includeArchived),
    enabled: Boolean(actor),
  })
  const accessibleTenants = tenantQuery.data?.items ?? []
  const tenantById = new Map(
    accessibleTenants.map((tenant) => [tenant.tenant_id, tenant])
  )
  const workspaces = (workspaceQuery.data?.items ?? []).filter((workspace) => {
    if (tenantQuery.isSuccess && !tenantById.has(workspace.tenant_id)) return false
    if (
      workspace.status === 'archived' &&
      !['owner', 'admin'].includes(workspace.workspace_role)
    )
      return false
    return true
  })
  return {
    actorId,
    tenants: accessibleTenants,
    tenantById,
    workspaces,
    tenantQuery,
    workspaceQuery,
  }
}

export async function loadAllPages<T>(
  path: string,
  includeArchived = false
): Promise<Page<T>> {
  const pageSize = 100
  const suffix = includeArchived ? '&include_archived=true' : ''
  const first = await api<Page<T>>(
    `${path}?page=1&page_size=${pageSize}${suffix}`
  )
  if (first.total <= first.items.length) return first
  const items = [...first.items]
  for (let page = 2; items.length < first.total; page += 1) {
    const next = await api<Page<T>>(
      `${path}?page=${page}&page_size=${pageSize}${suffix}`
    )
    if (!next.items.length) break
    items.push(...next.items)
  }
  return { ...first, items }
}

export function useWorkspaceSwitch(
  directory: ReturnType<typeof useWorkspaceDirectory>
) {
  const actor = useAuthStore((state) => state.auth.user)
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const queryClient = useQueryClient()
  const routeId = activeWorkspaceId(pathname)

  return React.useCallback(
    async (workspaceId: string) => {
      if (
        !actor ||
        directory.actorId !== actor.user_id ||
        !directory.tenantQuery.isSuccess ||
        !directory.workspaceQuery.isSuccess
      )
        return false

      const workspace = directory.workspaces.find(
        (item) => item.workspace_id === workspaceId
      )
      if (!workspace || !directory.tenantById.has(workspace.tenant_id))
        return false

      saveRecentWorkspace(actor.user_id, workspace)
      const previous = directory.workspaces.find(
        (item) => item.workspace_id === routeId
      )
      if (previous && previous.workspace_id !== workspace.workspace_id) {
        queryClient.removeQueries({
          predicate: (query) =>
            query.queryKey[0] === 'synapse' &&
            query.queryKey[1] === directory.actorId &&
            query.queryKey[3] === previous.workspace_id,
        })
      }
      await navigate({ to: workspacePath(workspace.workspace_id) as never })
      return true
    },
    [
      actor,
      directory.actorId,
      directory.tenantById,
      directory.tenantQuery.isSuccess,
      directory.workspaceQuery.isSuccess,
      directory.workspaces,
      navigate,
      queryClient,
      routeId,
    ]
  )
}

function activeWorkspaceId(pathname: string) {
  return pathname.match(/^\/w\/([^/]+)/)?.[1]
}

export function TeamSwitcher() {
  const t = useLocaleText()
  const locale = useLocale()
  const { isMobile, setOpenMobile } = useSidebar()
  const actor = useAuthStore((state) => state.auth.user)
  const directory = useWorkspaceDirectory(true)
  const { actorId, tenants, tenantById, workspaces, tenantQuery, workspaceQuery } = directory
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const switchWorkspace = useWorkspaceSwitch(directory)
  const [open, setOpen] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const routeFocusPending = React.useRef(false)
  const routeId = activeWorkspaceId(pathname)
  const recent = actor ? readRecentWorkspace(actor.user_id) : null
  const selected =
    workspaces.find((workspace) => workspace.workspace_id === routeId) ??
    workspaces.find(
      (workspace) => workspace.workspace_id === recent?.workspace_id
    ) ??
    (recent &&
    routeId === recent.workspace_id &&
    recent.status === 'archived' &&
    ['owner', 'admin'].includes(recent.workspace_role)
      ? recent
      : undefined)
  const selectedTenant = selected
    ? tenantById.get(selected.tenant_id)
    : undefined
  const directoryError = tenantQuery.isError || workspaceQuery.isError
  const directoryFailure = tenantQuery.isError
    ? tenantQuery.error
    : workspaceQuery.isError
      ? workspaceQuery.error
      : undefined
  const recoveryFailure =
    directoryFailure instanceof ApiProblem &&
    (directoryFailure.status === 403 ||
      directoryFailure.code === 'WORKSPACE_CONTEXT_REQUIRED' ||
      directoryFailure.code === 'CONTEXT_MISMATCH')
      ? directoryFailure
      : undefined
  const recoveryReason = recoveryFailure
    ? workspaceRecoveryReason(recoveryFailure.status, recoveryFailure.code)
    : undefined
  const directoryErrorMessage = recoveryReason
    ? workspaceRecoveryCopy(
        locale,
        recoveryReason === 'requestFailed' && recoveryFailure?.status === 403
          ? 'actionDenied'
          : recoveryReason
      )
    : t('无法加载可访问的 Workspace 目录。')
  const groups = directoryError
    ? []
    : tenants
        .map((tenant) => ({
          tenant,
          items: workspaces.filter((w) => w.tenant_id === tenant.tenant_id),
        }))
        .filter((group) => group.items.length)

  const switchTo = async (workspace: Workspace) => {
    if (!actor) return
    const switched = await switchWorkspace(workspace.workspace_id)
    if (!switched) return
    routeFocusPending.current = isMobile
    setOpen(false)
    if (isMobile) setOpenMobile(false)
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          {isMobile ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <SidebarMenuButton
                  size='lg'
                  aria-label={t('选择 Workspace')}
                  className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
                >
                  <div className='flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground'>
                    <Layers3 className='size-4' />
                  </div>
                  <div className='grid min-w-0 flex-1 text-start text-sm leading-tight'>
                    <span className='truncate font-semibold'>
                      {selected?.name ?? t('选择 Workspace')}
                    </span>
                    <span className='truncate text-xs text-muted-foreground'>
                      {selectedTenant?.name ??
                        (actor
                          ? t('仅显示已确认可访问的 Workspace')
                          : t('登录后查看可访问的 Workspace'))}
                    </span>
                  </div>
                  <ChevronsUpDown className='ms-auto size-4' />
                </SidebarMenuButton>
              </DialogTrigger>
              <DialogContent
                className='inset-0 left-0 top-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 !animate-none sm:hidden'
                showCloseButton={false}
                onOpenAutoFocus={(event) => {
                  event.preventDefault()
                  event.currentTarget
                    .querySelector<HTMLInputElement>('[cmdk-input]')
                    ?.focus()
                }}
                onCloseAutoFocus={(event) => {
                  if (!routeFocusPending.current) return
                  event.preventDefault()
                  routeFocusPending.current = false
                  document.getElementById('route-destination')?.focus()
                }}
              >
                <DialogHeader className='border-b px-4 py-4 pe-14 text-start'>
                  <DialogTitle>{t('切换 Workspace')}</DialogTitle>
                  <DialogDescription>
                    {t('仅显示已确认可访问的 Workspace')}
                  </DialogDescription>
                </DialogHeader>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='absolute end-3 top-3'
                  aria-label={t('关闭 Workspace 切换器')}
                  onClick={() => setOpen(false)}
                >
                  <X className='size-4' aria-hidden='true' />
                </Button>
                <WorkspaceSwitcherCommand
                  groups={groups}
                  selectedId={selected?.workspace_id}
                  loading={workspaceQuery.isLoading || tenantQuery.isLoading}
                  error={directoryError}
                  errorMessage={directoryErrorMessage}
                  onRetry={() => {
                    void Promise.all([
                      tenantQuery.refetch(),
                      workspaceQuery.refetch(),
                    ])
                  }}
                  onSelect={switchTo}
                  onCreate={() => {
                    setOpen(false)
                    setCreateOpen(true)
                  }}
                  canCreate={tenants.some(
                    (tenant) =>
                      tenant.tenant_role === 'owner' ||
                      tenant.tenant_role === 'admin'
                  )}
                />
              </DialogContent>
            </Dialog>
          ) : (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <SidebarMenuButton
                  size='lg'
                  aria-label={t('选择 Workspace')}
                  className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
                >
                  <div className='flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground'>
                    <Layers3 className='size-4' />
                  </div>
                  <div className='grid min-w-0 flex-1 text-start text-sm leading-tight'>
                    <span className='truncate font-semibold'>
                      {selected?.name ?? t('选择 Workspace')}
                    </span>
                    <span className='truncate text-xs text-muted-foreground'>
                      {selectedTenant?.name ??
                        (actor
                          ? t('仅显示已确认可访问的 Workspace')
                          : t('登录后查看可访问的 Workspace'))}
                    </span>
                  </div>
                  <ChevronsUpDown className='ms-auto size-4' />
                </SidebarMenuButton>
              </PopoverTrigger>
              <PopoverContent
                className='w-[min(22rem,calc(100vw-2rem))] p-0'
                align='start'
                side='right'
              >
                <WorkspaceSwitcherCommand
                  groups={groups}
                  selectedId={selected?.workspace_id}
                  loading={workspaceQuery.isLoading || tenantQuery.isLoading}
                  error={directoryError}
                  errorMessage={directoryErrorMessage}
                  onRetry={() => {
                    void Promise.all([
                      tenantQuery.refetch(),
                      workspaceQuery.refetch(),
                    ])
                  }}
                  onSelect={switchTo}
                  onCreate={() => {
                    setOpen(false)
                    setCreateOpen(true)
                  }}
                  canCreate={tenants.some(
                    (tenant) =>
                      tenant.tenant_role === 'owner' ||
                      tenant.tenant_role === 'admin'
                  )}
                />
              </PopoverContent>
            </Popover>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        tenants={tenants}
        actorId={actorId}
        onCreated={switchTo}
      />
    </>
  )
}

function WorkspaceSwitcherCommand({
  groups,
  selectedId,
  loading,
  error,
  errorMessage,
  onRetry,
  onSelect,
  onCreate,
  canCreate,
}: {
  groups: { tenant: TenantSummary; items: Workspace[] }[]
  selectedId?: string
  loading: boolean
  error: boolean
  errorMessage: string
  onRetry: () => void
  onSelect: (workspace: Workspace) => void
  onCreate: () => void
  canCreate: boolean
}) {
  const t = useLocaleText()

  return (
    <Command className='h-auto min-h-0 flex-1'>
      <CommandInput
        aria-label={t('搜索 Workspace 或租户…')}
        placeholder={t('搜索 Workspace 或租户…')}
      />
      <CommandList className='min-h-0 max-h-none flex-1'>
        <CommandEmpty>
          {error ? (
            <div className='space-y-3 px-4' role='alert'>
              <p>{errorMessage}</p>
              <Button type='button' variant='outline' onClick={onRetry}>
                {t('重新加载目录')}
              </Button>
            </div>
          ) : loading ? (
            <span role='status'>{t('正在加载可访问的 Workspace…')}</span>
          ) : (
            t('没有匹配的可访问 Workspace。')
          )}
        </CommandEmpty>
        {groups.map(({ tenant, items }) => (
          <CommandGroup key={tenant.tenant_id} heading={tenant.name}>
            {items.map((workspace) => (
              <CommandItem
                key={workspace.workspace_id}
                value={`${tenant.name} ${workspace.name} ${workspace.slug}`}
                onSelect={() => onSelect(workspace)}
              >
                <Layers3 className='size-4' aria-hidden='true' />
                <span className='min-w-0 flex-1 truncate' title={workspace.name}>
                  {workspace.name}
                </span>
                <span className='shrink-0 text-xs text-muted-foreground'>
                  {workspace.status === 'archived'
                    ? t('已归档')
                    : t(roleLabel[workspace.workspace_role])}
                </span>
                {workspace.workspace_id === selectedId ? (
                  <Check className='size-4' aria-label={t('当前 Workspace')} />
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {canCreate ? (
          <>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem onSelect={onCreate}>
                <Plus className='size-4' aria-hidden='true' />
                {t('创建 Workspace')}
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </Command>
  )
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  tenants,
  actorId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenants: TenantSummary[]
  actorId: string
  onCreated: (workspace: Workspace) => Promise<void>
}) {
  const client = useQueryClient()
  const eligible = tenants.filter(
    (tenant) => tenant.tenant_role === 'owner' || tenant.tenant_role === 'admin'
  )
  const [tenantId, setTenantId] = React.useState(eligible[0]?.tenant_id ?? '')
  const selectedTenantId = tenantId || eligible[0]?.tenant_id || ''
  const [name, setName] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [error, setError] = React.useState('')
  const create = useMutation({
    mutationFn: () => createWorkspace(selectedTenantId, { name, slug }),
    onSuccess: async (workspace) => {
      const actor = useAuthStore.getState().auth.user
      if (actor) saveRecentWorkspace(actor.user_id, workspace)
      await client.invalidateQueries({
        queryKey: [
          'synapse',
          actorId,
          'global',
          'personal',
          'workspace-directory',
        ],
      })
      setName('')
      setSlug('')
      setError('')
      onOpenChange(false)
      await onCreated(workspace)
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : '创建失败'),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle><LocalizedText text={"创建 Workspace"} /></DialogTitle>
          <DialogDescription>
            <LocalizedText text={"\n            创建者会成为空间所有者。其他租户成员需要逐个加入空间。\n          "} /></DialogDescription>
        </DialogHeader>
        <form
          className='space-y-4'
          onSubmit={(event) => {
            event.preventDefault()
            setError('')
            create.mutate()
          }}
        >
          <div className='space-y-2'>
            <Label htmlFor='workspace-tenant'><LocalizedText text={"所属租户"} /></Label>
            <LocalizedNativeSelect
              id='workspace-tenant'
              className='h-9 w-full rounded-md border bg-background px-3 text-sm'
              value={selectedTenantId}
              onChange={(event) => setTenantId(event.target.value)}
            >
              {eligible.map((tenant) => (
                <option key={tenant.tenant_id} value={tenant.tenant_id}>
                  {tenant.name}
                </option>
              ))}
            </LocalizedNativeSelect>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='workspace-name'><LocalizedText text={"名称"} /></Label>
            <Input
              id='workspace-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='workspace-slug'><LocalizedText text={"标识"} /></Label>
            <Input
              id='workspace-slug'
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              required
              maxLength={64}
              pattern='[a-z0-9]+(?:-[a-z0-9]+)*'
              placeholder='research-team'
            />
            <p className='text-xs text-muted-foreground'>
              <LocalizedText text={"\n              小写字母、数字和连字符。\n            "} /></p>
          </div>
          {error && (
            <p role='alert' className='text-sm text-destructive'>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              <LocalizedText text={"\n              取消\n            "} /></Button>
            <Button
              type='submit'
              disabled={
                !selectedTenantId ||
                !name.trim() ||
                !slug.trim() ||
                create.isPending
              }
            >
              {create.isPending ? <LocalizedText text={"创建中…"} /> : <LocalizedText text={"创建空间"} />}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
