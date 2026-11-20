import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeMcpPage } from '@/features/agentscope-resources'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/mcp')({
  component: AgentScopeMcpPage,
})
