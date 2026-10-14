import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeSkillsPage } from '@/features/agentscope-resources'
import { validateWorkspaceRoute } from '@/features/workspaces/context'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/skills')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: AgentScopeSkillsPage,
})
