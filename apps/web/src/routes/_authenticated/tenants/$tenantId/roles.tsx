import { createFileRoute, useParams } from '@tanstack/react-router'
import { TenantRolesPage } from '@/features/tenants/roles-page'

function TenantRolesRoute() {
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId/roles' })
  return <TenantRolesPage key={tenantId} />
}

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/roles')({
  component: TenantRolesRoute,
})
