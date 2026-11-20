import { createFileRoute, useRouteContext } from '@tanstack/react-router'
import {
  validateWorkspaceRoute,
  WorkspaceRouteLayout,
} from '@/features/workspaces/context'

function WorkspaceRoute() {
  const { actorId, workspace } = useRouteContext({
    from: '/_authenticated/w/$workspaceId',
  })
  return (
    <WorkspaceRouteLayout initialWorkspace={workspace} routeActorId={actorId} />
  )
}

export const Route = createFileRoute('/_authenticated/w/$workspaceId')({
  beforeLoad: ({ params, context }) =>
    validateWorkspaceRoute(params.workspaceId, context.queryClient),
  component: WorkspaceRoute,
})
