import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeOpsPage } from '@/features/agentscope-ops'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/channel')({
  component: () => <AgentScopeOpsPage initialTab='channels' />,
})
