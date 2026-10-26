import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { api, apiBlob, ApiProblem, restoreSession } from './api'

beforeEach(() => {
  useAuthStore.getState().auth.reset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  useAuthStore.getState().auth.reset()
})

describe('api request helpers', () => {
  it('uses an HttpOnly session cookie without exposing a bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(api<{ ok: boolean }>('/health')).resolves.toEqual({ ok: true })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('Authorization')).toBeNull()
    expect(init.credentials).toBe('include')
  })

  it('returns undefined for a 204 JSON request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    )

    await expect(
      api<void>('/resource', { method: 'DELETE' })
    ).resolves.toBeUndefined()
  })

  it('uses the shared API problem parser for blob failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: {
              code: 'FILE_NOT_FOUND',
              message: 'Attachment not found.',
            },
            errors: [
              { field: 'attachment_id', code: 'missing', message: 'Required.' },
            ],
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/problem+json' },
          }
        )
      )
    )

    const result = apiBlob('/attachments/missing')

    await expect(result).rejects.toBeInstanceOf(ApiProblem)
    await expect(result).rejects.toMatchObject({
      status: 404,
      code: 'FILE_NOT_FOUND',
      message: 'Attachment not found.',
      errors: [
        { field: 'attachment_id', code: 'missing', message: 'Required.' },
      ],
    })
  })

  it('resets the auth state on unauthorized responses', async () => {
    useAuthStore.getState().auth.setUser({
      user_id: '1',
      user_name: 'user',
      nick_name: null,
      email: null,
      phonenumber: null,
      sex: null,
      avatar: null,
      status: 'active',
      platform_role: 'user',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    )

    await expect(api('/private')).rejects.toMatchObject({ status: 401 })
    expect(useAuthStore.getState().auth.user).toBeNull()
  })

  it('restores the user from /auth/me with the cookie session', async () => {
    const user = {
      user_id: '7',
      user_name: 'cookie-user',
      nick_name: null,
      email: null,
      phonenumber: null,
      sex: null,
      avatar: null,
      status: 'active',
      platform_role: 'user',
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(user), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(restoreSession()).resolves.toEqual(user)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/me')
    expect(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.credentials
    ).toBe('include')
    expect(useAuthStore.getState().auth.user).toEqual(user)
  })

  it('normalizes network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    await expect(api('/health')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Unable to reach the server.',
    })
  })

  it('normalizes request timeouts without leaking an abort error', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(
                new DOMException('The operation was aborted.', 'AbortError')
              )
            })
          })
      )
    )

    const result = api('/slow', { timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(100)

    await expect(result).rejects.toMatchObject({
      status: 0,
      code: 'REQUEST_TIMEOUT',
      message: 'Request timed out after 100ms.',
    })
  })

  it('preserves caller cancellation as a distinct problem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(
                new DOMException('The operation was aborted.', 'AbortError')
              )
            })
          })
      )
    )
    const controller = new AbortController()
    const result = api('/cancelled', { signal: controller.signal })
    controller.abort()

    await expect(result).rejects.toMatchObject({
      status: 0,
      code: 'REQUEST_ABORTED',
      message: 'Request was cancelled.',
    })
  })
})
