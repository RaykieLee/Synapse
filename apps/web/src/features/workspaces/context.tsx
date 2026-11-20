import * as React from 'react'
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  Link,
  Outlet,
  redirect,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { toast } from 'sonner'
import { getWorkspace, listAllWorkspaces, type Page } from '@/api/workspaces'
import { useAuthStore } from '@/stores/auth-store'
import { ApiProblem } from '@/lib/api'
import { LocalizedText } from '@/components/localized-text'
import { queryKeys } from '@/lib/query-keys'
import {
  readRecentWorkspace,
  saveRecentWorkspace,
  useWorkspaceDirectory,
} from './directory'
import type { Workspace } from './types'

type WorkspaceContextValue = { workspace: Workspace; actorId: string }
const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null)

export const WORKSPACE_QUERY_STALE_TIME = 10_000

function workspaceDirectoryQueryKey(actorId: string, includeArchived: boolean) {
  return queryKeys.workspace.query(queryKeys.actorScope(actorId), 'directory', {
    includeArchived,
    page: 1,
    pageSize: 100,
  })
}

export function workspaceDetailQueryKey(
  actorId: string,
  workspace: Pick<
    Workspace,
    'tenant_id' | 'workspace_id' | 'membership_version'
  >
) {
  return queryKeys.workspace.resource(
    queryKeys.workspaceScope(actorId, workspace),
    ['workspace-detail']
  )
}

type WorkspaceRouteContextValue = {
  actorId: string
  workspace: Workspace
}

// Child file routes call validateWorkspaceRoute without router context. The
// workspace layout route registers the app's stable QueryClient first.
let workspaceRouteQueryClient: QueryClient | undefined

function unresolvedWorkspaceDetailQueryKey(
  actorId: string,
  workspaceId: string
) {
  return queryKeys.workspace.resource(
    { actorId, tenantId: 'unresolved', workspaceId, membershipVersion: 0 },
    ['workspace-detail']
  )
}

function sameWorkspaceDetailScope(
  left: Pick<Workspace, 'tenant_id' | 'workspace_id' | 'membership_version'>,
  right: Pick<Workspace, 'tenant_id' | 'workspace_id' | 'membership_version'>
) {
  return (
    left.tenant_id === right.tenant_id &&
    left.workspace_id === right.workspace_id &&
    (left.membership_version ?? 0) === (right.membership_version ?? 0)
  )
}

async function findAccessibleFallback(
  queryClient: QueryClient,
  actorId: string
) {
  try {
    const page = await queryClient.fetchQuery({
      queryKey: workspaceDirectoryQueryKey(actorId, false),
      queryFn: () => listAllWorkspaces(),
      staleTime: 0,
      retry: false,
    })
    return page.items.find((item) => item.status === 'active')
  } catch {
    return undefined
  }
}

function clearRecentWorkspace(actorId: string) {
  window.localStorage.removeItem(`synapse:recent-workspace:${actorId}`)
}

async function workspaceFallbackDestination(
  queryClient: QueryClient,
  actorId: string
) {
  clearRecentWorkspace(actorId)
  const fallback = await findAccessibleFallback(queryClient, actorId)
  toast.error(
    fallback
      ? '当前空间不可访问，已切换到可访问空间。'
      : '当前空间不可访问，已返回工作台。'
  )
  if (fallback) return { to: `/w/${fallback.workspace_id}` as never }
  return { to: '/' as const }
}

function updateWorkspaceDirectoryCache(
  queryClient: QueryClient,
  actorId: string,
  workspace: Workspace
) {
  queryClient.setQueryData<Page<Workspace>>(
    workspaceDirectoryQueryKey(actorId, true),
    (page) =>
      page && {
        ...page,
        items: page.items.map((item) =>
          item.workspace_id === workspace.workspace_id ? workspace : item
        ),
      }
  )
}

export function WorkspaceRouteLayout({
  initialWorkspace,
  routeActorId,
}: {
  initialWorkspace?: Workspace
  routeActorId?: string
} = {}) {
  const { workspaceId } = useParams({ from: '/_authenticated/w/$workspaceId' })
  const actor = useAuthStore((state) => state.auth.user)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const directory = useWorkspaceDirectory(true)
  const recent = actor ? readRecentWorkspace(actor.user_id) : null
  const fallbackInProgress = React.useRef(false)
  const routeWorkspace =
    actor?.user_id === routeActorId ? initialWorkspace : undefined
  const workspace =
    routeWorkspace ??
    directory.workspaces.find((item) => item.workspace_id === workspaceId) ??
    (recent?.workspace_id === workspaceId ? recent : undefined)
  const detailQueryKey = workspace
    ? workspaceDetailQueryKey(directory.actorId, workspace)
    : unresolvedWorkspaceDetailQueryKey(directory.actorId, workspaceId)
  const detail = useQuery({
    queryKey: detailQueryKey,
    queryFn: () => getWorkspace(workspaceId),
    enabled: Boolean(workspace && actor),
    initialData: routeWorkspace ?? workspace,
    staleTime: WORKSPACE_QUERY_STALE_TIME,
    refetchOnMount: false,
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
        queryKey: queryKeys.workspace.resource(
          queryKeys.actorScope(directory.actorId),
          'directory'
        ),
      })
    }
  }, [
    detail.data?.membership_version,
    directory.actorId,
    queryClient,
    workspace?.membership_version,
  ])

  React.useEffect(() => {
    if (!detail.isError) {
      fallbackInProgress.current = false
      return
    }
    if (!actor || !workspaceId || fallbackInProgress.current) return
    if (
      !(detail.error instanceof ApiProblem) ||
      ![403, 404, 409].includes(detail.error.status)
    )
      return
    fallbackInProgress.current = true
    void workspaceFallbackDestination(queryClient, directory.actorId)
      .then((destination) => navigate(destination as never))
      .catch(() => {
        fallbackInProgress.current = false
      })
  }, [
    actor,
    detail.isError,
    detail.error,
    directory.actorId,
    navigate,
    queryClient,
    workspaceId,
  ])

  if (!actor)
    return (
      <main className='p-6 text-sm text-muted-foreground'>
        <LocalizedText text={'\n        正在检查登录状态…\n      '} />
      </main>
    )
  if (directory.workspaceQuery.isLoading)
    return (
      <main className='p-6 text-sm text-muted-foreground'>
        <LocalizedText text={'\n        正在加载空间上下文…\n      '} />
      </main>
    )
  if (!workspace)
    return (
      <main className='space-y-3 p-6'>
        <h1 className='text-xl font-semibold'>
          <LocalizedText text={'空间不可用'} />
        </h1>
        <p className='text-sm text-muted-foreground'>
          <LocalizedText
            text={'\n          切换器只会显示当前可访问的空间。\n        '}
          />
        </p>
        <Link to='/' className='text-sm underline underline-offset-4'>
          <LocalizedText text={'\n          返回工作台\n        '} />
        </Link>
      </main>
    )
  if (detail.isError)
    return (
      <main className='space-y-3 p-6'>
        <h1 className='text-xl font-semibold'>
          <LocalizedText text={'无法验证空间'} />
        </h1>
        <p role='alert' className='text-sm text-destructive'>
          {detail.error instanceof ApiProblem &&
          [403, 404, 409].includes(detail.error.status)
            ? '当前空间不可访问，正在切换…'
            : '无法验证空间，请稍后重试。'}
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

export async function validateWorkspaceRoute(
  workspaceId: string,
  routeQueryClient?: QueryClient
): Promise<WorkspaceRouteContextValue> {
  const actorId = useAuthStore.getState().auth.user?.user_id
  if (!actorId)
    throw redirect({
      to: '/sign-in',
      search: { redirect: `/w/${workspaceId}` },
    })

  if (routeQueryClient) workspaceRouteQueryClient = routeQueryClient
  const queryClient = routeQueryClient ?? workspaceRouteQueryClient
  if (!queryClient)
    throw new Error('Workspace route validation requires the root QueryClient')

  try {
    const directoryKey = workspaceDirectoryQueryKey(actorId, true)
    let directory: Page<Workspace> | undefined
    try {
      directory = await queryClient.ensureQueryData({
        queryKey: directoryKey,
        queryFn: () => listAllWorkspaces(true),
        staleTime: WORKSPACE_QUERY_STALE_TIME,
        retry: false,
        revalidateIfStale: true,
      })
    } catch {
      directory = queryClient.getQueryData<Page<Workspace>>(directoryKey)
    }

    const listedWorkspace = directory?.items.find(
      (item) => item.workspace_id === workspaceId
    )
    const recentWorkspace = readRecentWorkspace(actorId)
    const scopedWorkspace =
      listedWorkspace ??
      (recentWorkspace?.workspace_id === workspaceId
        ? recentWorkspace
        : undefined)
    const queryKey = scopedWorkspace
      ? workspaceDetailQueryKey(actorId, scopedWorkspace)
      : unresolvedWorkspaceDetailQueryKey(actorId, workspaceId)
    const workspace = await queryClient.ensureQueryData({
      queryKey,
      queryFn: () => getWorkspace(workspaceId),
      staleTime: WORKSPACE_QUERY_STALE_TIME,
      retry: false,
      revalidateIfStale: true,
    })

    if (workspace.workspace_id !== workspaceId)
      throw new Error('Workspace detail response did not match the route ID')

    if (
      !scopedWorkspace ||
      !sameWorkspaceDetailScope(scopedWorkspace, workspace)
    ) {
      queryClient.setQueryData(
        workspaceDetailQueryKey(actorId, workspace),
        workspace
      )
      queryClient.removeQueries({ queryKey, exact: true })
      updateWorkspaceDirectoryCache(queryClient, actorId, workspace)
    }

    return { actorId, workspace }
  } catch (cause) {
    if (cause instanceof ApiProblem && [403, 404, 409].includes(cause.status)) {
      const destination = await workspaceFallbackDestination(
        queryClient,
        actorId
      )
      throw redirect(destination as never)
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
