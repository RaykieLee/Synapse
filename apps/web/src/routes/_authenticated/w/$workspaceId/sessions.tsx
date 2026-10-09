import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceSessionsPage } from '@/features/workspaces/sessions-page'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/sessions')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: WorkspaceSessionsPage,
})
