import { z } from 'zod'
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/clerk/(auth)/sign-in')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/sign-in', search, replace: true })
  },
})