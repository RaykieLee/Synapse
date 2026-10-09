import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceAgentsPage } from '@/features/workspaces/agents-page'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/agents')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: WorkspaceAgentsPage,
})
