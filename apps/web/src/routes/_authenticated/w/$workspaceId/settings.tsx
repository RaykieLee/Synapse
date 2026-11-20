import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceSettings } from '@/features/workspaces/pages'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/settings')({
  component: WorkspaceSettings,
})
