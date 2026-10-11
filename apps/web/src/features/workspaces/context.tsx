import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Link,
  Outlet,
  redirect,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { toast } from 'sonner'
import { getWorkspace, listAllWorkspaces } from '@/api/workspaces'
import { useAuthStore } from '@/stores/auth-store'
import { ApiProblem } from '@/lib/api'
import {
  readRecentWorkspace,
  saveRecentWorkspace,
  useWorkspaceDirectory,
} from './directory'
import type { Workspace } from './types'
import { LocalizedText } from '@/components/localized-text'

type WorkspaceContextValue = { workspace: Workspace; actorId: string }
const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null)

export function WorkspaceRouteLayout() {
  const { workspaceId } = useParams({ from: '/_authenticated/w/$workspaceId' })
  const actor = useAuthStore((state) => state.auth.user)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const directory = useWorkspaceDirectory(true)
  const recent = actor ? readRecentWorkspace(actor.user_id) : null
  const workspace =
    directory.workspaces.find((item) => item.workspace_id === workspaceId) ??
    (recent?.workspace_id === workspaceId ? recent : undefined)
  const detail = useQuery({
    queryKey: [
      'synapse',
      directory.actorId,
      workspace?.tenant_id ?? 'unresolved',
      workspaceId,
      'workspace-detail',
      workspace?.membership_version ?? 0,
    ],
    queryFn: () => getWorkspace(workspaceId),
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
    if (
      detail.data?.membership_version !== undefined &&
      detail.data.membership_version !== workspace?.membership_version
    ) {
      void queryClient.invalidateQueries({
        queryKey: [
          'synapse',
          directory.actorId,
          'global',
          'personal',
          'workspace-directory',
        ],
      })
    }
  }, [
    detail.data?.membership_version,
    directory.actorId,
    queryClient,
    workspace?.membership_version,
  ])

  React.useEffect(() => {
    if (
      !actor ||
      !workspaceId ||
      directory.workspaceQuery.isLoading ||
      !detail.isError
    )
      return
    if (
      !(detail.error instanceof ApiProblem) ||
      ![403, 404, 409].includes(detail.error.status)
    )
      return
    const fallback = directory.workspaces.find(
      (item) => item.workspace_id !== workspaceId
    )
    if (recent?.workspace_id === workspaceId)
      window.localStorage.removeItem(
        `synapse:recent-workspace:${actor.user_id}`
      )
    toast.error('此空间已不可访问，已切换到可访问空间。')
    void navigate(
      fallback ? { to: `/w/${fallback.workspace_id}` as never } : { to: '/' }
    )
  }, [
    actor,
    detail.isError,
    directory.workspaceQuery.isLoading,
    directory.workspaces,
    navigate,
    recent,
    workspace,
    workspaceId,
  ])

  if (!actor)
    return (
      <main className='p-6 text-sm text-muted-foreground'>
        <LocalizedText text={"\n        正在检查登录状态…\n      "} /></main>
    )
  if (directory.workspaceQuery.isLoading)
    return (
      <main className='p-6 text-sm text-muted-foreground'>
        <LocalizedText text={"\n        正在加载空间上下文…\n      "} /></main>
    )
  if (!workspace)
    return (
      <main className='space-y-3 p-6'>
        <h1 className='text-xl font-semibold'><LocalizedText text={"空间不可用"} /></h1>
        <p className='text-sm text-muted-foreground'>
          <LocalizedText text={"\n          切换器只会显示当前可访问的空间。\n        "} /></p>
        <Link to='/' className='text-sm underline underline-offset-4'>
          <LocalizedText text={"\n          返回工作台\n        "} /></Link>
      </main>
    )
  if (detail.isError)
    return (
      <main className='space-y-3 p-6'>
        <h1 className='text-xl font-semibold'><LocalizedText text={"无法验证空间"} /></h1>
        <p role='alert' className='text-sm text-destructive'>
          {detail.error.message}
        </p>
      </main>
    )
  return (
    <WorkspaceContext.Provider
      value={{
        workspace: detail.data ?? workspace,
        actorId: directory.actorId,
      }}
    >
      <Outlet />
    </WorkspaceContext.Provider>
  )
}

export async function validateWorkspaceRoute(workspaceId: string) {
  try {
    await getWorkspace(workspaceId)
  } catch (cause) {
    if (cause instanceof ApiProblem && [403, 404, 409].includes(cause.status)) {
      const actorId = useAuthStore.getState().auth.user?.user_id
      if (actorId)
        window.localStorage.removeItem(`synapse:recent-workspace:${actorId}`)
      let fallback: Workspace | undefined
      try {
        const page = await listAllWorkspaces()
        fallback = page.items.find((item) => item.status === 'active')
      } catch {
        /* the authenticated workspace list may itself be unavailable */
      }
      toast.error(
        fallback
          ? '当前空间不可访问，已切换到可访问空间。'
          : '当前空间不可访问，已返回工作台。'
      )
      if (fallback)
        throw redirect({ to: `/w/${fallback.workspace_id}` as never })
      throw redirect({ to: '/' })
    }
    throw cause
  }
}

export function useWorkspace() {
  const value = React.useContext(WorkspaceContext)
  if (!value)
    throw new Error('Workspace page must be inside WorkspaceRouteLayout')
  return value
}
