import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceHome } from '@/features/workspaces/pages'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: WorkspaceHome,
})
