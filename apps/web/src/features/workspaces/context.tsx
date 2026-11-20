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
  useRouter,
} from '@tanstack/react-router'
import { getWorkspace, listAllWorkspaces, type Page } from '@/api/workspaces'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { ApiProblem } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { useLocale } from '@/lib/i18n'
import {
  isWorkspaceAccessUnavailable,
  workspaceRecoveryCopy,
  workspaceRecoveryReason,
} from './workspace-recovery-messages'
import {
  WORKSPACE_QUERY_STALE_TIME,
  unresolvedWorkspaceDetailQueryKey,
  workspaceDetailQueryKey,
} from './workspace-query-keys'
import {
  readRecentWorkspace,
  saveRecentWorkspace,
  useWorkspaceDirectory,
} from './directory'
import type { Workspace } from './types'

export { WORKSPACE_QUERY_STALE_TIME, workspaceDetailQueryKey } from './workspace-query-keys'

type WorkspaceContextValue = { workspace: Workspace; actorId: string }
type WorkspaceRouteFailure = { status: number; code?: string }
type WorkspaceRouteContextValue = {
  actorId: string
  workspaceId: string
  workspace?: Workspace
  failure?: WorkspaceRouteFailure
}

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null)

function workspaceDirectoryQueryKey(actorId: string, includeArchived: boolean) {
  return queryKeys.workspace.query(queryKeys.actorScope(actorId), 'directory', {
    includeArchived,
    page: 1,
    pageSize: 100,
  })
}

let workspaceRouteQueryClient: QueryClient | undefined

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

function cachedWorkspaceDescriptor(
  queryClient: QueryClient,
  actorId: string,
  workspaceId: string
) {
  const matching = queryClient.getQueryCache().findAll({
    predicate: (query) => {
      const data = query.state.data
      return (
        query.queryKey[0] === 'synapse' &&
        query.queryKey[1] === actorId &&
        query.queryKey[3] === workspaceId &&
        query.queryKey[6] === 'workspace' &&
        query.queryKey[7] === 'workspace-detail' &&
        data !== null &&
        typeof data === 'object' &&
        'workspace_id' in data &&
        data.workspace_id === workspaceId &&
        'tenant_id' in data &&
        typeof data.tenant_id === 'string'
      )
    },
  })
  const tenantIds = new Set(
    matching
      .map((query) => query.queryKey[2])
      .filter((tenantId): tenantId is string => typeof tenantId === 'string')
  )
  if (tenantIds.size !== 1) return undefined
  return matching.find(
    (query) => query.queryKey[2] === [...tenantIds][0]
  )?.state.data as Workspace | undefined
}

function clearRecentWorkspace(actorId: string, workspaceId: string) {
  if (readRecentWorkspace(actorId)?.workspace_id === workspaceId) {
    window.localStorage.removeItem(`synapse:recent-workspace:${actorId}`)
  }
}

function invalidateWorkspaceDirectories(
  queryClient: QueryClient,
  actorId: string
) {
  const actorScope = queryKeys.actorScope(actorId)
  void queryClient.invalidateQueries({
    queryKey: queryKeys.tenant.resource(actorScope, 'directory'),
  })
  void queryClient.invalidateQueries({
    queryKey: queryKeys.workspace.resource(actorScope, 'directory'),
  })
}

function removeWorkspaceScopedQueries(
  queryClient: QueryClient,
  actorId: string,
  workspaceId: string,
  workspace?: Pick<Workspace, 'tenant_id' | 'workspace_id'>
) {
  const descriptor =
    workspace?.workspace_id === workspaceId
      ? workspace
      : cachedWorkspaceDescriptor(queryClient, actorId, workspaceId)
  if (!descriptor) return
  queryClient.removeQueries({
    queryKey: queryKeys.scope({
      actorId,
      tenantId: descriptor.tenant_id,
      workspaceId,
    }),
  })
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

function safeReturnTo(path: string) {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')
    ? path
    : '/'
}

function failureFromError(error: unknown): WorkspaceRouteFailure {
  return error instanceof ApiProblem
    ? { status: error.status, code: error.code }
    : { status: 0 }
}

function redirectToSignIn(returnTo: string): never {
  throw redirect({
    to: '/sign-in',
    search: { redirect: safeReturnTo(returnTo) },
    replace: true,
  })
}

function isAuthenticationFailure(error: unknown) {
  return error instanceof ApiProblem && error.status === 401
}

function handleWorkspaceAccessFailure(
  queryClient: QueryClient,
  actorId: string,
  workspaceId: string,
  workspace: Workspace | undefined,
  failure: WorkspaceRouteFailure
) {
  const reason = workspaceRecoveryReason(failure.status, failure.code)
  if (!isWorkspaceAccessUnavailable(reason)) return
  clearRecentWorkspace(actorId, workspaceId)
  removeWorkspaceScopedQueries(queryClient, actorId, workspaceId, workspace)
  invalidateWorkspaceDirectories(queryClient, actorId)
}

export function WorkspaceRouteLayout({
  initialWorkspace,
  initialFailure,
  routeActorId,
  routeWorkspaceId,
}: {
  initialWorkspace?: Workspace
  initialFailure?: WorkspaceRouteFailure
  routeActorId?: string
  routeWorkspaceId?: string
} = {}) {
  const { workspaceId } = useParams({ from: '/_authenticated/w/$workspaceId' })
  const actor = useAuthStore((state) => state.auth.user)
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const locale = useLocale()
  const directory = useWorkspaceDirectory(true)
  const recent = actor ? readRecentWorkspace(actor.user_id) : null
  const routeContextMatches =
    actor?.user_id === routeActorId && routeWorkspaceId === workspaceId
  const routeWorkspace = routeContextMatches ? initialWorkspace : undefined
  const routeFailure = routeContextMatches ? initialFailure : undefined
  const workspace =
    routeWorkspace ??
    directory.workspaces.find((item) => item.workspace_id === workspaceId) ??
    (recent?.workspace_id === workspaceId ? recent : undefined) ??
    (actor
      ? cachedWorkspaceDescriptor(queryClient, actor.user_id, workspaceId)
      : undefined)
  const detailQueryKey = workspace
    ? workspaceDetailQueryKey(directory.actorId, workspace)
    : unresolvedWorkspaceDetailQueryKey(directory.actorId, workspaceId)
  const routeKey = JSON.stringify([
    actor?.user_id ?? 'anonymous',
    workspaceId,
    workspace?.tenant_id ?? 'unresolved',
    workspace?.membership_version ?? 0,
  ])
  const [localFailure, setLocalFailure] = React.useState<{
    routeKey: string
    failure: WorkspaceRouteFailure
  } | null>(null)
  const currentLocalFailure =
    localFailure?.routeKey === routeKey ? localFailure.failure : undefined
  const detail = useQuery({
    queryKey: detailQueryKey,
    queryFn: () => getWorkspace(workspaceId),
    enabled: Boolean(
      actor && workspace && !routeFailure && !currentLocalFailure
    ),
    staleTime: WORKSPACE_QUERY_STALE_TIME,
    refetchOnMount: false,
    retry: false,
    refetchOnWindowFocus: true,
  })
  const failure =
    routeFailure ??
    currentLocalFailure ??
    (detail.isError ? failureFromError(detail.error) : undefined)
  const failureHandled = React.useRef<string | null>(null)
  const headingRef = React.useRef<HTMLHeadingElement>(null)

  React.useEffect(() => {
    if (!actor || routeFailure || !detail.isError) {
      if (!detail.isError) failureHandled.current = null
      return
    }
    if (isAuthenticationFailure(detail.error)) {
      void router.navigate({
        to: '/sign-in',
        search: { redirect: safeReturnTo(router.state.location.href) },
        replace: true,
      })
      return
    }
    const failureKey = `${routeKey}:${failureFromError(detail.error).status}:${failureFromError(detail.error).code ?? ''}`
    if (failureHandled.current === failureKey) return
    failureHandled.current = failureKey
    const nextFailure = failureFromError(detail.error)
    setLocalFailure({ routeKey, failure: nextFailure })
    handleWorkspaceAccessFailure(
      queryClient,
      actor.user_id,
      workspaceId,
      workspace,
      nextFailure
    )
  }, [
    actor,
    detail.error,
    detail.isError,
    queryClient,
    routeFailure,
    routeKey,
    router,
    workspace,
    workspaceId,
  ])

  React.useEffect(() => {
    if (!actor || !detail.data || detail.isError || detail.isFetching) return
    if (detail.data.workspace_id === workspaceId) {
      saveRecentWorkspace(actor.user_id, detail.data)
    }
  }, [actor, detail.data, detail.isError, detail.isFetching, workspaceId])

  React.useEffect(() => {
    if (
      !detail.data ||
      detail.data.workspace_id !== workspaceId ||
      detail.data.membership_version === workspace?.membership_version
    )
      return
    void queryClient.invalidateQueries({
      queryKey: queryKeys.workspace.resource(
        queryKeys.actorScope(directory.actorId),
        'directory'
      ),
    })
  }, [
    detail.data,
    directory.actorId,
    queryClient,
    workspace?.membership_version,
    workspaceId,
  ])

  React.useEffect(() => {
    if (!failure || document.activeElement !== document.body) return
    headingRef.current?.focus()
  }, [failure])

  const retry = () => {
    failureHandled.current = null
    setLocalFailure(null)
    if (routeFailure) {
      void router.invalidate()
      return
    }
    void detail.refetch()
  }

  if (!actor)
    return (
      <main
        aria-live='polite'
        className='p-6 text-sm text-muted-foreground'
        role='status'
      >
        {workspaceRecoveryCopy(locale, 'checking')}
      </main>
    )

  if (failure) {
    const reason = workspaceRecoveryReason(failure.status, failure.code)
    return (
      <main className='mx-auto flex w-full max-w-2xl flex-col gap-4 p-6 sm:p-8'>
        <h1 ref={headingRef} className='text-xl font-semibold' tabIndex={-1}>
          {workspaceRecoveryCopy(locale, 'title')}
        </h1>
        <p role='alert' className='text-sm text-muted-foreground'>
          {workspaceRecoveryCopy(locale, reason)}
        </p>
        <div className='flex flex-col gap-2 sm:flex-row'>
          <Button onClick={() => void navigate({ to: '/' })}>
            {workspaceRecoveryCopy(locale, 'viewAccessible')}
          </Button>
          <Button variant='outline' onClick={retry}>
            {workspaceRecoveryCopy(locale, 'retry')}
          </Button>
        </div>
      </main>
    )
  }

  if (
    directory.workspaceQuery.isLoading ||
    detail.isLoading ||
    detail.isFetching
  )
    return (
      <main
        aria-live='polite'
        className='p-6 text-sm text-muted-foreground'
        role='status'
      >
        {workspaceRecoveryCopy(locale, 'checking')}
      </main>
    )

  if (!workspace && !detail.data)
    return (
      <main className='space-y-3 p-6'>
        <h1 className='text-xl font-semibold'>
          {workspaceRecoveryCopy(locale, 'title')}
        </h1>
        <p className='text-sm text-muted-foreground'>
          {workspaceRecoveryCopy(locale, 'requestFailed')}
        </p>
        <Link to='/' className='text-sm underline underline-offset-4'>
          {workspaceRecoveryCopy(locale, 'viewAccessible')}
        </Link>
      </main>
    )

  return (
    <WorkspaceContext.Provider
      value={{
        workspace: detail.data ?? workspace!,
        actorId: directory.actorId,
      }}
    >
      <Outlet />
    </WorkspaceContext.Provider>
  )
}

export async function validateWorkspaceRoute(
  workspaceId: string,
  routeQueryClient?: QueryClient,
  returnTo = `/w/${workspaceId}`
): Promise<WorkspaceRouteContextValue> {
  const actorId = useAuthStore.getState().auth.user?.user_id
  if (!actorId) {
    redirectToSignIn(returnTo)
  }

  if (routeQueryClient) workspaceRouteQueryClient = routeQueryClient
  const queryClient = routeQueryClient ?? workspaceRouteQueryClient
  if (!queryClient)
    throw new Error('Workspace route validation requires the root QueryClient')

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
    (recentWorkspace?.workspace_id === workspaceId ? recentWorkspace : undefined) ??
    cachedWorkspaceDescriptor(queryClient, actorId, workspaceId)
  const queryKey = scopedWorkspace
    ? workspaceDetailQueryKey(actorId, scopedWorkspace)
    : unresolvedWorkspaceDetailQueryKey(actorId, workspaceId)

  try {
    const workspace = await queryClient.ensureQueryData({
      queryKey,
      queryFn: () => getWorkspace(workspaceId),
      staleTime: WORKSPACE_QUERY_STALE_TIME,
      retry: false,
      revalidateIfStale: true,
    })

    if (workspace.workspace_id !== workspaceId) {
      throw new Error('Workspace detail response did not match the route ID')
    }

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

    return { actorId, workspaceId, workspace }
  } catch (cause) {
    if (isAuthenticationFailure(cause)) redirectToSignIn(returnTo)
    const failure = failureFromError(cause)
    handleWorkspaceAccessFailure(
      queryClient,
      actorId,
      workspaceId,
      scopedWorkspace,
      failure
    )
    return { actorId, workspaceId, workspace: scopedWorkspace, failure }
  }
}

export function useWorkspace() {
  const value = React.useContext(WorkspaceContext)
  if (!value)
    throw new Error('Workspace page must be inside WorkspaceRouteLayout')
  return value
}
