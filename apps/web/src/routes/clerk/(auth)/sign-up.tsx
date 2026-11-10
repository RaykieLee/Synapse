import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/clerk/(auth)/sign-up')({
  beforeLoad: () => {
    throw redirect({ to: '/sign-up', replace: true })
  },
})