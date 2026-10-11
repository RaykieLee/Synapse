import { useEffect } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Layers3, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspaceDirectory, readRecentWorkspace } from '@/features/workspaces/directory'
import { useAuthStore } from '@/stores/auth-store'
import { LocalizedText } from '@/components/localized-text'

function AuthenticatedHome() {
  const actor = useAuthStore((state) => state.auth.user)
  const directory = useWorkspaceDirectory(true)
  const navigate = useNavigate()

  const recent = actor ? readRecentWorkspace(actor.user_id) : null
  const activeWorkspaces = directory.workspaces.filter(
    (workspace) => workspace.status === 'active'
  )
  const destination =
    activeWorkspaces.find(
      (workspace) => workspace.workspace_id === recent?.workspace_id
    ) ??
    activeWorkspaces[0]
  const archivedWorkspaces = directory.workspaces.filter(
    (workspace) => workspace.status === 'archived'
  )

  useEffect(() => {
    if (
      !directory.tenantQuery.isSuccess ||
      !directory.workspaceQuery.isSuccess ||
      !destination
    )
      return
    void navigate({ to: `/w/${destination.workspace_id}` as never, replace: true })
  }, [destination, directory.tenantQuery.isSuccess, directory.workspaceQuery.isSuccess, navigate])

  if (directory.tenantQuery.isPending || directory.workspaceQuery.isPending) {
    return (
      <main className='mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center p-6 text-sm text-muted-foreground' aria-live='polite'>
        <LocalizedText text='正在查找可访问的工作空间…' />
      </main>
    )
  }

  if (directory.tenantQuery.isError || directory.workspaceQuery.isError) {
    return (
      <main className='mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center'>
        <h1 className='text-xl font-semibold'><LocalizedText text='无法加载租户或工作空间目录' /></h1>
        <p className='text-sm text-muted-foreground'><LocalizedText text='请检查网络连接后重试。租户管理仍可从左侧菜单访问。' /></p>
        <Button
          onClick={() =>
            void Promise.all([
              directory.tenantQuery.refetch(),
              directory.workspaceQuery.refetch(),
            ])
          }
        >
          <RotateCcw className='size-4' />
          <LocalizedText text='重新加载' />
        </Button>
      </main>
    )
  }

  if (
    destination &&
    directory.tenantQuery.isSuccess &&
    directory.workspaceQuery.isSuccess
  ) {
    return (
      <main className='mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center p-6 text-sm text-muted-foreground' aria-live='polite'>
        <LocalizedText text='正在进入工作空间…' />
      </main>
    )
  }

  return (
    <main className='mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center'>
      <div className='flex size-12 items-center justify-center rounded-xl bg-muted'>
        <Layers3 className='size-6 text-muted-foreground' aria-hidden='true' />
      </div>
      <div className='space-y-2'>
        {archivedWorkspaces.length > 0 ? (
          <>
            <h1 className='text-2xl font-semibold tracking-tight'><LocalizedText text='没有可自动进入的活动工作空间' /></h1>
            <p className='text-sm leading-relaxed text-muted-foreground'>
              <LocalizedText text='以下工作空间均已归档。请选择一个进入管理；系统不会自动进入归档空间。' />
            </p>
          </>
        ) : (
          <>
            <h1 className='text-2xl font-semibold tracking-tight'><LocalizedText text='欢迎使用 Synapse' /></h1>
            <p className='text-sm leading-relaxed text-muted-foreground'>
              <LocalizedText text='当前账号还没有可访问的工作空间。请先查看租户成员资格；有创建权限时，也可以从左上角选择器创建工作空间。' />
            </p>
          </>
        )}
      </div>
      {archivedWorkspaces.length > 0 && (
        <div className='flex w-full max-w-md flex-col gap-2'>
          {archivedWorkspaces.map((workspace) => (
            <Button key={workspace.workspace_id} variant='outline' asChild>
              <Link to={`/w/${workspace.workspace_id}` as never}>
                <Layers3 className='size-4' />
                <span className='truncate'>{workspace.name}</span>
                <span className='ms-auto text-xs text-muted-foreground'><LocalizedText text='已归档 · 进入管理' /></span>
              </Link>
            </Button>
          ))}
        </div>
      )}
      <Button asChild variant={archivedWorkspaces.length > 0 ? 'ghost' : 'default'}>
        <Link to='/tenants'><LocalizedText text='查看租户' /></Link>
      </Button>
    </main>
  )
}

export const Route = createFileRoute('/_authenticated/')({
  component: AuthenticatedHome,
})
