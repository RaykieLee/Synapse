import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeSopPage } from '@/features/agentscope-sop'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/sop')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: AgentScopeSopPage,
})
