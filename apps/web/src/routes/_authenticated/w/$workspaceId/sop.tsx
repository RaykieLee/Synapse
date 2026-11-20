import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeSopPage } from '@/features/agentscope-sop'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/sop')({
  component: AgentScopeSopPage,
})
