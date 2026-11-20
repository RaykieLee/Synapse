import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeOpsPage } from '@/features/agentscope-ops'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/schedule')({
  component: () => <AgentScopeOpsPage initialTab='schedules' />,
})
