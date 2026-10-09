import { useAuthStore } from '@/stores/auth-store'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '')

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
  constructor(status: number, code?: string, detail?: string) {
    super(detail || `Request failed (${status})`)
    this.status = status
    this.code = code
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().auth.accessToken
  const headers = new Headers(init.headers)
  const multipart = typeof FormData !== 'undefined' && init.body instanceof FormData
  if (init.body && !multipart && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch {
    throw new ApiProblem(0, 'NETWORK_ERROR', 'Unable to reach the server.')
  }
  if (response.status === 401) useAuthStore.getState().auth.reset()
  if (!response.ok) {
    let problem: { code?: string; detail?: string | { code?: string; message?: string }; title?: string } = {}
    try { problem = await response.json() } catch { /* non-JSON error */ }
    const detail = typeof problem.detail === 'string'
      ? problem.detail
      : problem.detail?.message || problem.detail?.code
    throw new ApiProblem(response.status, problem.code || (typeof problem.detail === 'object' ? problem.detail?.code : undefined), detail || problem.title)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function apiBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const token = useAuthStore.getState().auth.accessToken
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch {
    throw new ApiProblem(0, 'NETWORK_ERROR', 'Unable to reach the server.')
  }
  if (response.status === 401) useAuthStore.getState().auth.reset()
  if (!response.ok) {
    let problem: { code?: string; detail?: string | { code?: string; message?: string }; title?: string } = {}
    try { problem = await response.json() } catch { /* non-JSON error */ }
    const detail = typeof problem.detail === 'string'
      ? problem.detail
      : problem.detail?.message || problem.detail?.code
    throw new ApiProblem(response.status, problem.code || (typeof problem.detail === 'object' ? problem.detail?.code : undefined), detail || problem.title)
  }
  return response.blob()
}
