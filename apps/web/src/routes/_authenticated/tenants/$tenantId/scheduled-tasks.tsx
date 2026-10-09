import { createFileRoute, useParams } from '@tanstack/react-router'
import { TenantScheduledTasksPage } from '@/features/tenants/scheduled-tasks-page'

function TenantScheduledTasksRoute() {
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId/scheduled-tasks' })
  return <TenantScheduledTasksPage key={tenantId} />
}

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/scheduled-tasks')({
  component: TenantScheduledTasksRoute,
})
