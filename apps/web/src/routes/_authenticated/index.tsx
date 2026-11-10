import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Layers3, RotateCcw } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { LocalizedText } from '@/components/localized-text'
import { useWorkbenchMessage } from '@/features/workspaces/workbench-messages'
import {
  readRecentWorkspace,
  saveRecentWorkspace,
  useWorkspaceDirectory,
} from '@/features/workspaces/directory'
import {
  roleLabel,
  statusLabel,
  type Workspace,
} from '@/features/workspaces/types'

function WorkspaceCard({
  workspace,
  tenantName,
  onOpen,
}: {
  workspace: Workspace
  tenantName: string | undefined
  onOpen: (workspace: Workspace) => void
}) {
  const unavailableTenantName = useWorkbenchMessage('租户名称暂不可用')

  return (
    <article className='flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between'>
      <div className='min-w-0'>
        <p
          className='truncate text-xs text-muted-foreground'
          title={tenantName ?? unavailableTenantName}
        >
          {tenantName ?? unavailableTenantName}
        </p>
        <h3 className='truncate font-semibold' title={workspace.name}>
          {workspace.name}
        </h3>
        <p
          className='truncate text-xs text-muted-foreground'
          title={workspace.slug}
        >
          {workspace.slug}
        </p>
        <div className='mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground'>
          <span>
            <LocalizedText text='状态：' />
            <LocalizedText text={statusLabel[workspace.status]} />
          </span>
          <span>
            <LocalizedText text='角色：' />
            <LocalizedText text={roleLabel[workspace.workspace_role]} />
          </span>
        </div>
      </div>
      <Button asChild className='min-h-11 shrink-0' variant='outline'>
        <Link
          to={`/w/${workspace.workspace_id}` as never}
          onClick={() => onOpen(workspace)}
        >
          <Layers3 className='size-4' aria-hidden='true' />
          <LocalizedText text='进入 Workspace' />
        </Link>
      </Button>
    </article>
  )
}

function WorkspaceSection({
  title,
  workspaces,
  tenantById,
  onOpen,
}: {
  title: string
  workspaces: Workspace[]
  tenantById: ReadonlyMap<string, { name: string }>
  onOpen: (workspace: Workspace) => void
}) {
  const { groups, unmappedWorkspaces } = workspaces.reduce(
    (result, workspace) => {
      const tenantName = tenantById.get(workspace.tenant_id)?.name
      if (!tenantName) {
        result.unmappedWorkspaces.push(workspace)
        return result
      }
      const current = result.groups.get(workspace.tenant_id) ?? {
        tenantName,
        workspaces: [] as Workspace[],
      }
      current.workspaces.push(workspace)
      result.groups.set(workspace.tenant_id, current)
      return result
    },
    {
      groups: new Map<string, { tenantName: string; workspaces: Workspace[] }>(),
      unmappedWorkspaces: [] as Workspace[],
    }
  )
  const groupedWorkspaces = Array.from(groups.entries())

  return (
    <section className='space-y-3' aria-labelledby={`${title}-heading`}>
      <div className='flex items-baseline justify-between gap-3'>
        <h2 id={`${title}-heading`} className='text-lg font-semibold'>
          <LocalizedText text={title} />
        </h2>
        <span className='text-xs text-muted-foreground'>
          {workspaces.length}
        </span>
      </div>
      {groupedWorkspaces.length === 0 && unmappedWorkspaces.length === 0 ? (
        <p className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>
          <LocalizedText text='暂无此状态的 Workspace。' />
        </p>
      ) : (
        <div className='space-y-4'>
          {groupedWorkspaces.map(([tenantId, group]) => (
            <div key={tenantId} className='space-y-2'>
              <h3 className='text-sm font-medium text-muted-foreground'>
                <LocalizedText text='租户：' />
                {group.tenantName}
              </h3>
              <div className='grid gap-3'>
                {group.workspaces.map((workspace) => (
                  <WorkspaceCard
                    key={workspace.workspace_id}
                    workspace={workspace}
                    tenantName={group.tenantName}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            </div>
          ))}
          {unmappedWorkspaces.map((workspace) => (
            <WorkspaceCard
              key={workspace.workspace_id}
              workspace={workspace}
              tenantName={undefined}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function AuthenticatedHome() {
  const actor = useAuthStore((state) => state.auth.user)
  const directory = useWorkspaceDirectory(true)
  const navigate = useNavigate()
  const tenantDirectoryFailure = useWorkbenchMessage('无法加载租户目录')
  const bothDirectoriesFailure = useWorkbenchMessage(
    '租户和 Workspace 目录均无法加载'
  )
  const directoryFailureGuidance = useWorkbenchMessage(
    '仅展示成功加载的目录数据；失败的目录不作为权限或“无 Workspace”依据。请重试失败项。'
  )

  const recent = actor ? readRecentWorkspace(actor.user_id) : null
  const directoryReady =
    directory.tenantQuery.isSuccess && directory.workspaceQuery.isSuccess
  const activeWorkspaces = directory.workspaces.filter(
    (workspace) => workspace.status === 'active'
  )
  const archivedWorkspaces = directory.workspaces.filter(
    (workspace) => workspace.status === 'archived'
  )
  const verifiedRecent = recent
    ? directory.workspaces.find(
        (workspace) => workspace.workspace_id === recent.workspace_id
      )
    : undefined

  const openWorkspace = (workspace: Workspace) => {
    if (actor) saveRecentWorkspace(actor.user_id, workspace)
    void navigate({ to: `/w/${workspace.workspace_id}` as never })
  }

  if (
    (directory.tenantQuery.isPending || directory.workspaceQuery.isPending) &&
    !directory.tenantQuery.isError &&
    !directory.workspaceQuery.isError
  ) {
    return (
      <main
        className='mx-auto min-h-[60vh] max-w-4xl space-y-6 p-6'
        aria-busy='true'
      >
        <header className='space-y-2'>
          <h1 className='text-2xl font-semibold'>
            <LocalizedText text='工作台' />
          </h1>
          <p className='text-sm text-muted-foreground' aria-live='polite'>
            <LocalizedText text='正在加载租户和 Workspace…' />
          </p>
        </header>
        <div className='grid gap-3' aria-hidden='true'>
          <div className='h-24 animate-pulse rounded-xl bg-muted' />
          <div className='h-24 animate-pulse rounded-xl bg-muted' />
        </div>
      </main>
    )
  }

  if (directory.tenantQuery.isError || directory.workspaceQuery.isError) {
    return (
      <main className='mx-auto min-h-[60vh] max-w-4xl space-y-6 p-6'>
        <header className='space-y-2'>
          <h1 className='text-2xl font-semibold'>
            <LocalizedText text='工作台' />
          </h1>
          <div
            role='alert'
            className='rounded-xl border border-destructive/40 bg-destructive/5 p-4'
          >
            <p className='font-medium'>
              {directory.tenantQuery.isError &&
              directory.workspaceQuery.isError ? (
                bothDirectoriesFailure
              ) : directory.tenantQuery.isError ? (
                tenantDirectoryFailure
              ) : (
                <LocalizedText text='无法加载 Workspace 目录' />
              )}
            </p>
            <p className='mt-1 text-sm text-muted-foreground'>
              {directoryFailureGuidance}
            </p>
            <div className='mt-3 flex flex-wrap gap-2'>
              {directory.tenantQuery.isError && (
                <Button
                  variant='outline'
                  onClick={() => void directory.tenantQuery.refetch()}
                  disabled={directory.tenantQuery.isFetching}
                >
                  <RotateCcw className='size-4' />
                  <LocalizedText text='重试租户目录' />
                </Button>
              )}
              {directory.workspaceQuery.isError && (
                <Button
                  variant='outline'
                  onClick={() => void directory.workspaceQuery.refetch()}
                  disabled={directory.workspaceQuery.isFetching}
                >
                  <RotateCcw className='size-4' />
                  <LocalizedText text='重试 Workspace 目录' />
                </Button>
              )}
            </div>
          </div>
        </header>
        {directory.tenantQuery.isSuccess && directory.tenants.length > 0 && (
          <section className='space-y-2' aria-labelledby='loaded-tenants-heading'>
            <h2 id='loaded-tenants-heading' className='text-lg font-semibold'>
              <LocalizedText text='已加载的租户' />
            </h2>
            <div className='grid gap-2 sm:grid-cols-2'>
              {directory.tenants.map((tenant) => (
                <div
                  key={tenant.tenant_id}
                  className='rounded-xl border p-3 text-sm'
                >
                  {tenant.name}
                </div>
              ))}
            </div>
          </section>
        )}
        {directory.workspaceQuery.isSuccess && (
            <div className='space-y-6'>
              <WorkspaceSection
                title='活动 Workspace'
                workspaces={directory.workspaces.filter(
                  (workspace) => workspace.status === 'active'
                )}
                tenantById={directory.tenantById}
                onOpen={openWorkspace}
              />
              <WorkspaceSection
                title='已归档 Workspace'
                workspaces={directory.workspaces.filter(
                  (workspace) => workspace.status === 'archived'
                )}
                tenantById={directory.tenantById}
                onOpen={openWorkspace}
              />
            </div>
          )}
      </main>
    )
  }

  return (
    <main className='mx-auto min-h-[60vh] max-w-4xl space-y-8 p-6'>
      <header className='space-y-2'>
        <h1 className='text-2xl font-semibold'>
          <LocalizedText text='工作台' />
        </h1>
        <p className='text-sm text-muted-foreground'>
          <LocalizedText text='选择一个 Workspace 开始工作。系统不会自动进入最近、首个或唯一的 Workspace。' />
        </p>
      </header>

      {verifiedRecent && (
        <section
          className='rounded-xl border border-primary/30 bg-primary/5 p-4'
          aria-labelledby='recent-workspace-heading'
        >
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div className='min-w-0'>
              <p id='recent-workspace-heading' className='text-sm font-medium'>
                <LocalizedText text='继续上次访问的 Workspace' />
              </p>
              <p className='truncate text-sm text-muted-foreground'>
                {directory.tenantById.get(verifiedRecent.tenant_id)?.name} ·{' '}
                {verifiedRecent.name}
              </p>
            </div>
            <Button asChild className='min-h-11 shrink-0'>
              <Link
                to={`/w/${verifiedRecent.workspace_id}` as never}
                onClick={() => openWorkspace(verifiedRecent)}
              >
                <LocalizedText text='继续' />
              </Link>
            </Button>
          </div>
        </section>
      )}

      {directoryReady && directory.workspaces.length === 0 ? (
        <section className='rounded-xl border border-dashed p-6'>
          <div className='flex items-start gap-3'>
            <div className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted'>
              <Layers3
                className='size-5 text-muted-foreground'
                aria-hidden='true'
              />
            </div>
            <div className='space-y-2'>
              <h2 className='font-semibold'>
                <LocalizedText text='当前账号没有可访问的 Workspace' />
              </h2>
              <p className='text-sm text-muted-foreground'>
                <LocalizedText text='请查看租户成员资格，或联系租户管理员加入 Workspace。' />
              </p>
              <Button asChild variant='outline' className='min-h-11'>
                <Link to='/tenants'>
                  <LocalizedText text='查看租户' />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <WorkspaceSection
            title='活动 Workspace'
            workspaces={activeWorkspaces}
            tenantById={directory.tenantById}
            onOpen={openWorkspace}
          />
          <WorkspaceSection
            title='已归档 Workspace'
            workspaces={archivedWorkspaces}
            tenantById={directory.tenantById}
            onOpen={openWorkspace}
          />
          {archivedWorkspaces.length > 0 && (
            <p className='text-sm text-muted-foreground'>
              <LocalizedText text='已归档 Workspace 不会自动进入；请显式选择“进入 Workspace”。' />
            </p>
          )}
        </>
      )}
    </main>
  )
}

export const Route = createFileRoute('/_authenticated/')({
  component: AuthenticatedHome,
})
