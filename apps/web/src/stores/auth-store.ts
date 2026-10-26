import { create } from 'zustand'
import type { AuthUser } from '@/lib/api'

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  auth: {
    user: null,
    setUser: (user) => set((s) => ({ auth: { ...s.auth, user } })),
    reset: () => set((s) => ({ auth: { ...s.auth, user: null } })),
  },
}))
