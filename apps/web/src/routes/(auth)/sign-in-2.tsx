import { z } from 'zod'
import { createFileRoute, redirect } from '@tanstack/react-router'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/sign-in-2')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/sign-in', search })
  },
})
