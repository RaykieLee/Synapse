import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeKnowledgePage } from '@/features/agentscope-resources'

export const Route = createFileRoute(
  '/_authenticated/w/$workspaceId/knowledge'
)({
  component: AgentScopeKnowledgePage,
})
