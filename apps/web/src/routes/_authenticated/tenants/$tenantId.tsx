import { createFileRoute, Outlet, useMatchRoute, useParams } from '@tanstack/react-router'
import { TenantDetail } from '@/features/tenants'

function TenantDetailRoute() {
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId' })
  const matchRoute = useMatchRoute()
  const rolesChildActive = matchRoute({ to: '/tenants/$tenantId/roles', params: { tenantId } })
  const menusChildActive = matchRoute({ to: '/tenants/$tenantId/menus', params: { tenantId } })
  const departmentsChildActive = matchRoute({ to: '/tenants/$tenantId/departments', params: { tenantId } })
  const dictionariesChildActive = matchRoute({ to: '/tenants/$tenantId/dictionaries', params: { tenantId } })
  const configsChildActive = matchRoute({ to: '/tenants/$tenantId/configs', params: { tenantId } })
  const scheduledTasksChildActive = matchRoute({ to: '/tenants/$tenantId/scheduled-tasks', params: { tenantId } })

  // This route is both the tenant detail page and the layout for tenant
  // subroutes. Keep the detail as the exact-path view; render only the child
  // outlet when a nested page such as /roles is active.
  return rolesChildActive || menusChildActive || departmentsChildActive || dictionariesChildActive || configsChildActive || scheduledTasksChildActive ? <Outlet /> : <TenantDetail />
}

export const Route = createFileRoute('/_authenticated/tenants/$tenantId')({ component: TenantDetailRoute })
