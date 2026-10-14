import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeKnowledgePage } from '@/features/agentscope-resources'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute(
  '/_authenticated/w/$workspaceId/knowledge'
)({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: AgentScopeKnowledgePage,
})
