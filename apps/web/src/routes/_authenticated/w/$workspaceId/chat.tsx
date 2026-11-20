import { createFileRoute } from '@tanstack/react-router'

import { AgentScopeChatPage } from '@/features/agentscope-chat'

export const Route = createFileRoute('/_authenticated/w/$workspaceId/chat')({
  component: AgentScopeChatPage,
})
