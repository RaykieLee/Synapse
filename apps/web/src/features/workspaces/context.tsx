import * as React from 'react'
import { Link, Outlet, redirect, useNavigate, useParams } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiProblem, api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { loadAllPages, readRecentWorkspace, saveRecentWorkspace, useWorkspaceDirectory } from './directory'
import type { Workspace } from './types'

type WorkspaceContextValue = { workspace: Workspace; actorId: string }
const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null)

export function WorkspaceRouteLayout() {
  const { workspaceId } = useParams({ from: '/_authenticated/w/$workspaceId' })
  const actor = useAuthStore((state) => state.auth.user)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const directory = useWorkspaceDirectory(true)
  const recent = actor ? readRecentWorkspace(actor.user_id) : null
  const workspace = directory.workspaces.find((item) => item.workspace_id === workspaceId)
    ?? (recent?.workspace_id === workspaceId ? recent : undefined)
  const detail = useQuery({
    queryKey: ['synapse', directory.actorId, workspace?.tenant_id ?? 'unresolved', workspaceId, 'workspace-detail', workspace?.membership_version ?? 0],
    queryFn: () => api<Workspace>(`/workspaces/${workspaceId}`, { headers: { 'X-Workspace-ID': workspaceId } }),
    enabled: Boolean(workspace && actor),
    initialData: workspace,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  React.useEffect(() => {
    if (!actor || !workspace || detail.isError) return
    if (detail.data) saveRecentWorkspace(actor.user_id, detail.data)
  }, [actor, detail.data, detail.isError, workspace])

  React.useEffect(() => {
    if (detail.data?.membership_version !== undefined &&
        detail.data.membership_version !== workspace?.membership_version) {
      void queryClient.invalidateQueries({ queryKey: ['synapse', directory.actorId, 'global', 'personal', 'workspace-directory'] })
    }
  }, [detail.data?.membership_version, directory.actorId, queryClient, workspace?.membership_version])

  React.useEffect(() => {
    if (!actor || !workspaceId || directory.workspaceQuery.isLoading || !detail.isError) return
    if (!(detail.error instanceof ApiProblem) || ![403, 404, 409].includes(detail.error.status)) return
    const fallback = directory.workspaces.find((item) => item.workspace_id !== workspaceId)
    if (recent?.workspace_id === workspaceId) window.localStorage.removeItem(`synapse:recent-workspace:${actor.user_id}`)
    toast.error('此空间已不可访问，已切换到可访问空间。')
    void navigate(fallback ? { to: `/w/${fallback.workspace_id}` as never } : { to: '/' })
  }, [actor, detail.isError, directory.workspaceQuery.isLoading, directory.workspaces, navigate, recent, workspace, workspaceId])

  if (!actor) return <main className='p-6 text-sm text-muted-foreground'>正在检查登录状态…</main>
  if (directory.workspaceQuery.isLoading) return <main className='p-6 text-sm text-muted-foreground'>正在加载空间上下文…</main>
  if (!workspace) return <main className='space-y-3 p-6'><h1 className='text-xl font-semibold'>空间不可用</h1><p className='text-sm text-muted-foreground'>切换器只会显示当前可访问的空间。</p><Link to='/' className='text-sm underline underline-offset-4'>返回工作台</Link></main>
  if (detail.isError) return <main className='space-y-3 p-6'><h1 className='text-xl font-semibold'>无法验证空间</h1><p role='alert' className='text-sm text-destructive'>{detail.error.message}</p></main>
  return <WorkspaceContext.Provider value={{ workspace: detail.data ?? workspace, actorId: directory.actorId }}><Outlet /></WorkspaceContext.Provider>
}

export async function validateWorkspaceRoute(workspaceId: string) {
  try {
    await api<Workspace>(`/workspaces/${workspaceId}`, { headers: { 'X-Workspace-ID': workspaceId } })
  } catch (cause) {
    if (cause instanceof ApiProblem && [403, 404, 409].includes(cause.status)) {
      const actorId = useAuthStore.getState().auth.user?.user_id
      if (actorId) window.localStorage.removeItem(`synapse:recent-workspace:${actorId}`)
      let fallback: Workspace | undefined
      try {
        const page = await loadAllPages<Workspace>('/workspaces')
        fallback = page.items.find((item) => item.status === 'active')
      } catch { /* the authenticated workspace list may itself be unavailable */ }
      toast.error(fallback ? '当前空间不可访问，已切换到可访问空间。' : '当前空间不可访问，已返回工作台。')
      if (fallback) throw redirect({ to: `/w/${fallback.workspace_id}` as never })
      throw redirect({ to: '/' })
    }
    throw cause
  }
}

export function useWorkspace() {
  const value = React.useContext(WorkspaceContext)
  if (!value) throw new Error('Workspace page must be inside WorkspaceRouteLayout')
  return value
}
