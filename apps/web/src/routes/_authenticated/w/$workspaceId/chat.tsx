import { createFileRoute } from '@tanstack/react-router'

import { validateWorkspaceRoute } from '@/features/workspaces/context'
import { AgentScopeChatPage } from '@/features/agentscope-chat'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/chat')({
  beforeLoad: ({ params }) => validateWorkspaceRoute(params.workspaceId),
  component: AgentScopeChatPage,
})
