import { createFileRoute, useRouteContext } from '@tanstack/react-router'
import {
  validateWorkspaceRoute,
  WorkspaceRouteLayout,
} from '@/features/workspaces/context'

function WorkspaceRoute() {
  const { actorId, failure, workspace, workspaceId } = useRouteContext({
    from: '/_authenticated/w/$workspaceId',
  })
  return (
    <WorkspaceRouteLayout
      initialWorkspace={workspace}
      initialFailure={failure}
      routeActorId={actorId}
      routeWorkspaceId={workspaceId}
    />
  )
}

export const Route = createFileRoute('/_authenticated/w/$workspaceId')({
  beforeLoad: ({ params, context, location }) =>
    validateWorkspaceRoute(params.workspaceId, context.queryClient, location.href),
  component: WorkspaceRoute,
})
