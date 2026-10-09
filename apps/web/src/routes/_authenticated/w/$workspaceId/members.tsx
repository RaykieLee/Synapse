import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceMembers } from '@/features/workspaces/pages'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/members')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: WorkspaceMembers,
})
