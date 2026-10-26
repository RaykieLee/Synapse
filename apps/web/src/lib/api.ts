import { useAuthStore } from '@/stores/auth-store'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(
  /\/$/,
  ''
)
export const DEFAULT_API_TIMEOUT_MS = 30_000

export type ApiProblemFieldError = {
  field: string
  code?: string
  message?: string
}

function problemFieldErrors(
  value: unknown
): ApiProblemFieldError[] | undefined {
  if (!Array.isArray(value)) return undefined
  const errors = value.flatMap((item): ApiProblemFieldError[] => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Record<string, unknown>
    if (typeof entry.field !== 'string') return []
    return [
      {
        field: entry.field,
        ...(typeof entry.code === 'string' ? { code: entry.code } : {}),
        ...(typeof entry.message === 'string'
          ? { message: entry.message }
          : {}),
      },
    ]
  })
  return errors.length ? errors : undefined
}

export type AuthUser = {
  user_id: string
  user_name: string
  nick_name: string | null
  email: string | null
  phonenumber: string | null
  sex: string | null
  avatar: string | null
  status: string
  platform_role: string
}

export class ApiProblem extends Error {
  status: number
  code?: string
  errors?: ApiProblemFieldError[]
  constructor(
    status: number,
    code?: string,
    detail?: string,
    errors?: ApiProblemFieldError[]
  ) {
    super(detail || `Request failed (${status})`)
    this.status = status
    this.code = code
    this.errors = errors
  }
}

type ProblemPayload = {
  code?: string
  detail?: string | { code?: string; message?: string }
  title?: string
  errors?: unknown
}

export type ApiRequestInit = RequestInit & {
  timeoutMs?: number
}

async function problemFromResponse(response: Response): Promise<ApiProblem> {
  let problem: ProblemPayload = {}
  try {
    problem = await response.json()
  } catch {
    /* non-JSON error */
  }
  const detail =
    typeof problem.detail === 'string'
      ? problem.detail
      : problem.detail?.message || problem.detail?.code
  const code =
    problem.code ||
    (typeof problem.detail === 'object' ? problem.detail?.code : undefined)
  return new ApiProblem(
    response.status,
    code,
    detail || problem.title,
    problemFieldErrors(problem.errors)
  )
}

async function request(
  path: string,
  init: ApiRequestInit = {}
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    signal: callerSignal,
    ...requestInit
  } = init
  const headers = new Headers(requestInit.headers)
  const multipart =
    typeof FormData !== 'undefined' && requestInit.body instanceof FormData
  if (requestInit.body && !multipart && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json')
  const controller = new AbortController()
  let timedOut = false
  const timeoutId = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const abortFromCaller = () => controller.abort()
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort()
    else callerSignal.addEventListener('abort', abortFromCaller, { once: true })
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...requestInit,
      headers,
      signal: controller.signal,
      credentials: 'include',
    })
  } catch (error) {
    if (timedOut) {
      throw new ApiProblem(
        0,
        'REQUEST_TIMEOUT',
        `Request timed out after ${timeoutMs}ms.`
      )
    }
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'AbortError'
    ) {
      throw new ApiProblem(0, 'REQUEST_ABORTED', 'Request was cancelled.')
    }
    throw new ApiProblem(0, 'NETWORK_ERROR', 'Unable to reach the server.')
  } finally {
    window.clearTimeout(timeoutId)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
  if (response.status === 401) useAuthStore.getState().auth.reset()
  if (!response.ok) throw await problemFromResponse(response)
  return response
}

let sessionProbe: Promise<AuthUser> | null = null

export async function restoreSession(): Promise<AuthUser> {
  const cached = useAuthStore.getState().auth.user
  if (cached) return cached
  if (!sessionProbe) {
    sessionProbe = api<AuthUser>('/auth/me')
      .then((user) => {
        useAuthStore.getState().auth.setUser(user)
        return user
      })
      .finally(() => {
        sessionProbe = null
      })
  }
  return sessionProbe
}

export async function api<T>(
  path: string,
  init: ApiRequestInit = {}
): Promise<T> {
  const response = await request(path, init)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function apiBlob(
  path: string,
  init: ApiRequestInit = {}
): Promise<Blob> {
  const response = await request(path, init)
  return response.blob()
}
