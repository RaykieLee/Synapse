import * as React from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Check, ChevronsUpDown, Plus, Layers3 } from 'lucide-react'
import { createWorkspace, listAllWorkspaces } from '@/api/workspaces'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
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
import { useLocaleText } from '@/lib/i18n'

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
    const tenant = tenantById.get(workspace.tenant_id)
    if (!tenant) return false
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

function activeWorkspaceId(pathname: string) {
  return pathname.match(/^\/w\/([^/]+)/)?.[1]
}

export function TeamSwitcher() {
  const t = useLocaleText()
  const { isMobile } = useSidebar()
  const actor = useAuthStore((state) => state.auth.user)
  const { actorId, tenants, tenantById, workspaces, workspaceQuery } =
    useWorkspaceDirectory(true)
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [open, setOpen] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
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
  const groups = tenants
    .map((tenant) => ({
      tenant,
      items: workspaces.filter((w) => w.tenant_id === tenant.tenant_id),
    }))
    .filter((group) => group.items.length)

  const switchTo = async (workspace: Workspace) => {
    if (!actor) return
    const previous =
      workspaces.find((item) => item.workspace_id === routeId) ??
      (recent?.workspace_id === routeId ? recent : undefined) ??
      (recent?.workspace_id === routeId ? recent : undefined)
    saveRecentWorkspace(actor.user_id, workspace)
    setOpen(false)
    if (previous && previous.workspace_id !== workspace.workspace_id) {
      // Query keys keep old responses inside their former scope. Remove old UI subscriptions;
      // api() deliberately does not bind request lifetime to the route or abort in-flight jobs.
      client.removeQueries({
        predicate: (query) =>
          query.queryKey[0] === 'synapse' &&
          query.queryKey[1] === actorId &&
          query.queryKey[3] === previous.workspace_id,
      })
    }
    await navigate({ to: workspacePath(workspace.workspace_id) as never })
  }

  // Captured through the stable QueryClient provider so route changes only drop old observers.
  const client = useQueryClient()

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <SidebarMenuButton
                size='lg'
                aria-label={t('选择工作区')}
                className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
              >
                <div className='flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground'>
                  <Layers3 className='size-4' />
                </div>
                <div className='grid flex-1 text-start text-sm leading-tight'>
                  <span className='truncate font-semibold'>
                    {selected?.name ?? '选择工作区'}
                  </span>
                  <span className='truncate text-xs text-muted-foreground'>
                    {selectedTenant?.name ??
                      (actor ? '仅显示已加入的空间' : '登录后查看空间')}
                  </span>
                </div>
                <ChevronsUpDown className='ms-auto size-4' />
              </SidebarMenuButton>
            </PopoverTrigger>
            <PopoverContent
              className='w-[min(22rem,calc(100vw-2rem))] p-0'
              align='start'
              side={isMobile ? "bottom" : "right"}
            >
              <Command>
                <CommandInput placeholder='搜索空间或租户…' />
                <CommandList>
                  <CommandEmpty>
                    {workspaceQuery.isLoading ? <LocalizedText text={"正在加载空间…"} /> : <LocalizedText text={"没有匹配的可访问空间"} />}
                  </CommandEmpty>
                  {groups.map(({ tenant, items }) => (
                    <CommandGroup key={tenant.tenant_id} heading={tenant.name}>
                      {items.map((workspace) => (
                        <CommandItem
                          key={workspace.workspace_id}
                          value={`${tenant.name} ${workspace.name} ${workspace.slug}`}
                          onSelect={() => void switchTo(workspace)}
                        >
                          <Layers3 className='size-4' />
                          <span className='min-w-0 flex-1 truncate'>
                            {workspace.name}
                          </span>
                          <span className='text-xs text-muted-foreground'>
                            {workspace.status === 'archived' ? <LocalizedText text={"已归档"} /> : roleLabel[workspace.workspace_role]}
                          </span>
                          {workspace.workspace_id ===
                            selected?.workspace_id && (
                            <Check className='size-4' />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                  {tenants.some(
                    (tenant) =>
                      tenant.tenant_role === 'owner' ||
                      tenant.tenant_role === 'admin'
                  ) && (
                    <>
                      <CommandSeparator />
                      <CommandGroup>
                        <CommandItem
                          onSelect={() => {
                            setOpen(false)
                            setCreateOpen(true)
                          }}
                        >
                          <Plus className='size-4' /> <LocalizedText text={" 创建空间\n                        "} /></CommandItem>
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
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
