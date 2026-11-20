import { api } from '@/lib/api'
import type { components } from '@/api/generated/openapi'

export type GlobalUserStatus = 'active' | 'disabled'

export type GlobalUser = Omit<
  components['schemas']['UserResponse'],
  'status'
> & { status: GlobalUserStatus }

export type UserPage = Omit<
  components['schemas']['UserPageResponse'],
  'items'
> & { items: GlobalUser[] }

export type UserListParams = {
  page?: number
  pageSize?: number
  search?: string
}

export type UserCreatePayload = components['schemas']['UserCreate']

export type UserPatchPayload = Omit<
  components['schemas']['UserPatch'],
  'status'
> & { status?: GlobalUserStatus }

export type UserProfilePayload = Pick<
  UserPatchPayload,
  'nick_name' | 'email' | 'phonenumber' | 'sex' | 'avatar'
>

export type UserPasswordResetPayload = components['schemas']['PasswordReset']

function withQuery(path: string, params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

export function listUsers(params: UserListParams = {}) {
  return api<UserPage>(
    withQuery('/users', {
      page: params.page,
      page_size: params.pageSize,
      search: params.search,
    })
  )
}

export function createUser(payload: UserCreatePayload) {
  return api<GlobalUser>('/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function patchUser(userId: string, payload: UserPatchPayload) {
  return api<GlobalUser>(`/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteUser(userId: string) {
  return api<void>(`/users/${userId}`, { method: 'DELETE' })
}

export function resetUserPassword(
  userId: string,
  payload: UserPasswordResetPayload
) {
  return api<void>(`/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
