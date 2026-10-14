import * as React from 'react'

import { useWorkspace } from '@/features/workspaces/context'
import { AgentScopeKnowledgePage } from './knowledge-page'
import { AgentScopeMcpPage } from './mcp-page'
import { AgentScopeSkillsPage } from './skills-page'

export type AgentScopeResourceKind = 'knowledge' | 'mcp' | 'skills'

export function AgentScopeResourcesPage({
  initialKind = 'knowledge',
  workspaceId: workspaceIdProp,
}: {
  initialKind?: AgentScopeResourceKind
  workspaceId?: string
}) {
  const workspace = useWorkspace()
  const workspaceId = workspaceIdProp ?? workspace.workspace.workspace_id
  const [kind, setKind] = React.useState<AgentScopeResourceKind>(initialKind)
  return (
    <main className='min-h-full'>
      <nav className='flex flex-wrap gap-2 border-b px-6 pt-6'>
        {([
          ['knowledge', 'Knowledge'],
          ['mcp', 'MCP'],
          ['skills', 'Skills'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type='button'
            className={`border-b-2 px-3 pb-3 text-sm ${kind === value ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
            onClick={() => setKind(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {kind === 'knowledge' && <AgentScopeKnowledgePage workspaceId={workspaceId} />}
      {kind === 'mcp' && <AgentScopeMcpPage workspaceId={workspaceId} />}
      {kind === 'skills' && <AgentScopeSkillsPage workspaceId={workspaceId} />}
    </main>
  )
}

export { AgentScopeKnowledgePage } from './knowledge-page'
export { AgentScopeMcpPage } from './mcp-page'
export { AgentScopeSkillsPage } from './skills-page'
