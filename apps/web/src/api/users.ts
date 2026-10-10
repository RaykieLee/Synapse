import { api } from '@/lib/api'

export type GlobalUserStatus = 'active' | 'disabled'

export type GlobalUser = {
  user_id: string
  user_name: string
  nick_name: string | null
  email: string | null
  phonenumber: string | null
  sex: string | null
  avatar: string | null
  status: GlobalUserStatus
  platform_role: string
  created_at: string | null
  updated_at: string | null
}

export type UserPage = {
  items: GlobalUser[]
  total: number
  page: number
  page_size: number
}

export type UserListParams = {
  page?: number
  pageSize?: number
  search?: string
}

export type UserCreatePayload = {
  user_name: string
  password: string
  nick_name?: string
  email?: string | null
  phonenumber?: string | null
  sex?: string | null
  avatar?: string | null
}

export type UserPatchPayload = Partial<
  Pick<
    GlobalUser,
    'nick_name' | 'email' | 'phonenumber' | 'sex' | 'avatar' | 'status'
  >
>

export type UserProfilePayload = Pick<
  UserPatchPayload,
  'nick_name' | 'email' | 'phonenumber' | 'sex' | 'avatar'
>

export type UserPasswordResetPayload = {
  new_password: string
}

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
