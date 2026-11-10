import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceRouteLayout } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId')({
  component: WorkspaceRouteLayout,
})
