import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceModelsPage } from '@/features/workspaces/models-page'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/models')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: WorkspaceModelsPage,
})
