import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceAttachments } from '@/features/workspaces/attachments-page'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/attachments')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: WorkspaceAttachments,
})
