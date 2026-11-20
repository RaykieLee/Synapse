import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeSkillsPage } from '@/features/agentscope-resources'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/skills')({
  component: AgentScopeSkillsPage,
})
