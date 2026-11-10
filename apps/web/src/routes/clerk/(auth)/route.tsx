import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/clerk/(auth)')({
  component: Outlet,
})