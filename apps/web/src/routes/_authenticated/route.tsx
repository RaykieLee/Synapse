import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { api, type AuthUser } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const auth = useAuthStore.getState().auth
    if (!auth.accessToken) throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    try {
      const user = await api<AuthUser>('/auth/me')
      useAuthStore.getState().auth.setUser(user)
    } catch {
      useAuthStore.getState().auth.reset()
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
  },
  component: AuthenticatedLayout,
})
