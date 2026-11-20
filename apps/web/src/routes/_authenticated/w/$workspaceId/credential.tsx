import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeCredentialPage } from '@/features/agentscope-credential'

export const Route = createFileRoute(
  '/_authenticated/w/$workspaceId/credential'
)({
  component: AgentScopeCredentialPage,
})
