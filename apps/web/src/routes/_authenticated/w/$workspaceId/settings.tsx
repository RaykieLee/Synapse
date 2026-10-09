import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceSettings } from '@/features/workspaces/pages'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/settings')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: WorkspaceSettings,
})
