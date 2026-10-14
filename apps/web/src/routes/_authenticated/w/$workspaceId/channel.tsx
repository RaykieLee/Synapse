import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeOpsPage } from '@/features/agentscope-ops'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/channel')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: () => <AgentScopeOpsPage initialTab='channels' />,
})
