import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceModelsPage } from '@/features/workspaces/models-page'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/models')({
  component: WorkspaceModelsPage,
})
