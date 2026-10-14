import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeMcpPage } from '@/features/agentscope-resources'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/mcp')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: AgentScopeMcpPage,
})
