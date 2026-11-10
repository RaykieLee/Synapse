import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/clerk/_authenticated')({
  component: Outlet,
})