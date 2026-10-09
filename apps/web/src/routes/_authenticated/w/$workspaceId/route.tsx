import { createFileRoute } from '@tanstack/react-router'
import { validateWorkspaceRoute, WorkspaceRouteLayout } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: WorkspaceRouteLayout,
})
