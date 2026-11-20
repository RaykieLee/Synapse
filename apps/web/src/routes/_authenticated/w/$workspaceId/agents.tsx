import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceAgentsPage } from '@/features/workspaces/agents-page'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/agents')({
  component: WorkspaceAgentsPage,
})
