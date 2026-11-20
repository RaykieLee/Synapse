import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceHome } from '@/features/workspaces/pages'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/')({
  component: WorkspaceHome,
})
