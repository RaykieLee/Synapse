import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Outlet,
  useNavigate,
  useParams,
  useRouter,
} from '@tanstack/react-router'
import { getWorkspace } from '@/api/workspaces'
import { useAuthStore } from '@/stores/auth-store'
import { ApiProblem } from '@/lib/api'
import { useLocale } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  readRecentWorkspace,
  saveRecentWorkspace,
  useWorkspaceDirectory,
} from './directory'
import type { Workspace } from './types'
import {
  isWorkspaceAccessUnavailable,
  workspaceRecoveryCopy,
  workspaceRecoveryReason,
} from './workspace-recovery-messages'

type WorkspaceContextValue = { workspace: Workspace; actorId: string }
const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null)

type WorkspaceVerification =
  | {
      actorId: string
      attempt: number
      state: 'checking'
      workspaceId: string
    }
  | {
      actorId: string
      attempt: number
      state: 'verified'
      workspace: Workspace
      workspaceId: string
    }
  | {
      actorId: string
      attempt: number
      code?: string
      state: 'failed'
      status: number
      workspaceId: string
    }

function isWorkspaceScopedQuery(
  queryKey: readonly unknown[],
  actorId: string,
  tenantId: string,
  workspaceId: string
) {
  return (
    queryKey[0] === 'synapse' &&
    queryKey[1] === actorId &&
    queryKey[2] === tenantId &&
    queryKey[3] === workspaceId &&
    queryKey.length >= 5
  )
}

function cachedWorkspaceTenantId(
  queryClient: ReturnType<typeof useQueryClient>,
  actorId: string,
  workspaceId: string
) {
  const matchingDetails = queryClient.getQueryCache().findAll({
    predicate: (query) => {
      const [namespace, queryActorId, tenantId, queryWorkspaceId, resource] =
        query.queryKey
      const cachedWorkspace = query.state.data
      return (
        namespace === 'synapse' &&
        queryActorId === actorId &&
        typeof tenantId === 'string' &&
        queryWorkspaceId === workspaceId &&
        resource === 'workspace-detail' &&
        cachedWorkspace !== null &&
        typeof cachedWorkspace === 'object' &&
        'workspace_id' in cachedWorkspace &&
        cachedWorkspace.workspace_id === workspaceId &&
        'tenant_id' in cachedWorkspace &&
        cachedWorkspace.tenant_id === tenantId
      )
    },
  })
  const tenantIds = [
    ...new Set(matchingDetails.map((query) => query.queryKey[2])),
  ]
  return tenantIds.length === 1 && typeof tenantIds[0] === 'string'
    ? tenantIds[0]
    : undefined
}

function safeReturnTo(path: string) {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')
    ? path
    : '/'
}

export function WorkspaceRouteLayout() {
  const { workspaceId } = useParams({ from: '/_authenticated/w/$workspaceId' })
  const actor = useAuthStore((state) => state.auth.user)
  const actorId = actor?.user_id
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const locale = useLocale()
  const directory = useWorkspaceDirectory(true)
  const [attempt, setAttempt] = React.useState(0)
  const [verification, setVerification] =
    React.useState<WorkspaceVerification | null>(null)
  const recent = actorId ? readRecentWorkspace(actorId) : null
  const knownWorkspace =
    directory.workspaces.find((item) => item.workspace_id === workspaceId) ??
    (recent?.workspace_id === workspaceId ? recent : undefined)
  const currentRoute = React.useRef({
    actorId,
    attempt,
    knownWorkspace,
    workspaceId,
  })
  currentRoute.current = { actorId, attempt, knownWorkspace, workspaceId }

  const verificationForRoute =
    verification &&
    verification.actorId === actorId &&
    verification.attempt === attempt &&
    verification.workspaceId === workspaceId
      ? verification
      : null

  React.useEffect(() => {
    if (!actorId) return
    let current = true
    setVerification({ actorId, attempt, state: 'checking', workspaceId })
    void getWorkspace(workspaceId)
      .then((workspace) => {
        const latest = currentRoute.current
        if (
          !current ||
          latest.actorId !== actorId ||
          latest.attempt !== attempt ||
          latest.workspaceId !== workspaceId
        )
          return
        saveRecentWorkspace(actorId, workspace)
        setVerification({
          actorId,
          attempt,
          state: 'verified',
          workspace,
          workspaceId,
        })
      })
      .catch((cause: unknown) => {
        const latest = currentRoute.current
        if (cause instanceof ApiProblem && cause.status === 401) {
          const pathname = router.state.location.pathname
          if (
            (latest.actorId && latest.actorId !== actorId) ||
            (pathname !== `/w/${workspaceId}` &&
              !pathname.startsWith(`/w/${workspaceId}/`))
          )
            return
          void navigate({
            to: '/sign-in',
            search: { redirect: safeReturnTo(router.state.location.href) },
            replace: true,
          })
          return
        }
        if (
          !current ||
          latest.actorId !== actorId ||
          latest.attempt !== attempt ||
          latest.workspaceId !== workspaceId
        )
          return
        if (latest.actorId !== actorId) return

        const status = cause instanceof ApiProblem ? cause.status : 0
        const code = cause instanceof ApiProblem ? cause.code : undefined
        const reason = workspaceRecoveryReason(status, code)
        if (isWorkspaceAccessUnavailable(reason)) {
          const recentWorkspace = readRecentWorkspace(actorId)
          if (recentWorkspace?.workspace_id === workspaceId)
            window.localStorage.removeItem(
              `synapse:recent-workspace:${actorId}`
            )

          const targetTenantId =
            latest.knownWorkspace?.tenant_id ??
            (recentWorkspace?.workspace_id === workspaceId
              ? recentWorkspace.tenant_id
              : undefined) ??
            cachedWorkspaceTenantId(queryClient, actorId, workspaceId)
          if (targetTenantId) {
            void queryClient.removeQueries({
              predicate: (query) =>
                isWorkspaceScopedQuery(
                  query.queryKey,
                  actorId,
                  targetTenantId,
                  workspaceId
                ),
            })
          }
          void queryClient.invalidateQueries({
            queryKey: [
              'synapse',
              actorId,
              'global',
              'personal',
              'tenant-directory',
            ],
          })
          void queryClient.invalidateQueries({
            queryKey: [
              'synapse',
              actorId,
              'global',
              'personal',
              'workspace-directory',
            ],
          })
        }

        setVerification({
          actorId,
          attempt,
          ...(code ? { code } : {}),
          state: 'failed',
          status,
          workspaceId,
        })
      })
    return () => {
      current = false
    }
  }, [actorId, attempt, navigate, queryClient, router, workspaceId])

  React.useEffect(() => {
    if (verificationForRoute?.state !== 'verified') return
    if (
      knownWorkspace?.membership_version !== undefined &&
      verificationForRoute.workspace.membership_version !==
        knownWorkspace.membership_version
    ) {
      void queryClient.invalidateQueries({
        queryKey: [
          'synapse',
          actorId,
          'global',
          'personal',
          'workspace-directory',
        ],
      })
    }
  }, [
    actorId,
    knownWorkspace?.membership_version,
    queryClient,
    verificationForRoute,
  ])

  const viewAccessibleWorkspaces = React.useCallback(() => {
    if (actorId) {
      void queryClient.invalidateQueries({
        queryKey: [
          'synapse',
          actorId,
          'global',
          'personal',
          'tenant-directory',
        ],
      })
      void queryClient.invalidateQueries({
        queryKey: [
          'synapse',
          actorId,
          'global',
          'personal',
          'workspace-directory',
        ],
      })
    }
    void navigate({ to: '/' })
  }, [actorId, navigate, queryClient])

  const headingRef = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => {
    if (
      verificationForRoute?.state === 'failed' &&
      document.activeElement === document.body
    )
      headingRef.current?.focus()
  }, [verificationForRoute])

  if (
    !actorId ||
    !verificationForRoute ||
    verificationForRoute.state === 'checking'
  )
    return (
      <main
        aria-live='polite'
        className='p-6 text-sm text-muted-foreground'
        role='status'
      >
        {workspaceRecoveryCopy(locale, attempt ? 'retrying' : 'checking')}
      </main>
    )

  if (verificationForRoute.state === 'failed') {
    const failureReason = workspaceRecoveryReason(
      verificationForRoute.status,
      verificationForRoute.code
    )
    return (
      <main className='mx-auto flex w-full max-w-2xl flex-col gap-4 p-6 sm:p-8'>
        <h1 ref={headingRef} className='text-xl font-semibold' tabIndex={-1}>
          {workspaceRecoveryCopy(locale, 'title')}
        </h1>
        <p role='alert' className='text-sm text-muted-foreground'>
          {workspaceRecoveryCopy(locale, failureReason)}
        </p>
        <div className='flex flex-col gap-2 sm:flex-row'>
          <Button onClick={viewAccessibleWorkspaces}>
            {workspaceRecoveryCopy(locale, 'viewAccessible')}
          </Button>
          <Button
            variant='outline'
            onClick={() => setAttempt((previous) => previous + 1)}
          >
            {workspaceRecoveryCopy(locale, 'retry')}
          </Button>
        </div>
      </main>
    )
  }

  return (
    <WorkspaceContext.Provider
      value={{
        workspace: verificationForRoute.workspace,
        actorId,
      }}
    >
      <Outlet />
    </WorkspaceContext.Provider>
  )
}

export function validateWorkspaceRoute(_workspaceId: string) {}

export function useWorkspace() {
  const value = React.useContext(WorkspaceContext)
  if (!value)
    throw new Error('Workspace page must be inside WorkspaceRouteLayout')
  return value
}
