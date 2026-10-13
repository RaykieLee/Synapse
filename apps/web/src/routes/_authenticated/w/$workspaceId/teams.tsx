import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceTeamsPage } from '@/features/workspaces/teams-page'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/teams')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: WorkspaceTeamsPage,
})
