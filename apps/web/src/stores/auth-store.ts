import { create } from 'zustand'
import { getCookie, setCookie, removeCookie } from '@/lib/cookies'
import type { AuthUser } from '@/lib/api'

const ACCESS_TOKEN = 'synapse_access_token'
interface AuthState {
  auth: {
    user: AuthUser | null
    accessToken: string
    setUser: (user: AuthUser | null) => void
    setAccessToken: (token: string) => void
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  auth: {
    user: null,
    accessToken: getCookie(ACCESS_TOKEN) ?? '',
    setUser: (user) => set((s) => ({ auth: { ...s.auth, user } })),
    setAccessToken: (accessToken) => set((s) => {
      if (accessToken) setCookie(ACCESS_TOKEN, accessToken, 60 * 60)
      else removeCookie(ACCESS_TOKEN)
      return { auth: { ...s.auth, accessToken } }
    }),
    reset: () => set((s) => {
      removeCookie(ACCESS_TOKEN)
      return { auth: { ...s.auth, user: null, accessToken: '' } }
    }),
  },
}))
