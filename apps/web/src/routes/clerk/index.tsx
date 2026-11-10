import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/clerk/')({
  beforeLoad: () => {
    throw redirect({ to: '/sign-in', replace: true })
  },
})