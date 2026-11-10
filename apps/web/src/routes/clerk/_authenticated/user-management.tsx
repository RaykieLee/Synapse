import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/clerk/_authenticated/user-management')({
  beforeLoad: () => {
    throw redirect({ to: '/users', replace: true })
  },
})