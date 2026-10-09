import { redirect, createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Users } from '@/features/users'
import { useAuthStore } from '@/stores/auth-store'

const usersSearchSchema = z.object({
  page: z.number().int().min(1).optional().catch(1),
  pageSize: z.number().int().min(1).max(100).optional().catch(20),
  search: z.string().optional().catch(''),
})

export const Route = createFileRoute('/_authenticated/users/')({
  beforeLoad: () => {
    if (useAuthStore.getState().auth.user?.platform_role !== 'platform_admin') {
      throw redirect({ to: '/403' })
    }
  },
  validateSearch: usersSearchSchema,
  component: Users,
})
