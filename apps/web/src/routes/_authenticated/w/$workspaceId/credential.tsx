import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeCredentialPage } from '@/features/agentscope-credential'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute(
  '/_authenticated/w/$workspaceId/credential'
)({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: AgentScopeCredentialPage,
})
