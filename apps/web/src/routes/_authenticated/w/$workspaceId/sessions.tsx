import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceSessionsPage } from '@/features/workspaces/sessions-page'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/sessions')({
  component: WorkspaceSessionsPage,
})
