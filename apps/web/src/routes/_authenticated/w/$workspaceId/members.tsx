import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceMembers } from '@/features/workspaces/pages'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/members')({
  component: WorkspaceMembers,
})
