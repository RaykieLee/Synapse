import { createFileRoute, Outlet } from '@tanstack/react-router'
import { NotFoundError } from '@/features/errors/not-found-error'

export const Route = createFileRoute('/clerk')({
  component: Outlet,
  notFoundComponent: NotFoundError,
})
