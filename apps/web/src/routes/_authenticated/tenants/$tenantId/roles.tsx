import { createFileRoute, useParams } from '@tanstack/react-router'
import { z } from 'zod'
import { TenantRolesPage } from '@/features/tenants/roles-page'

const rolesSearchSchema = z.object({
  page: z.number().int().min(1).optional().catch(1),
  q: z.string().max(100).optional().catch(''),
  status: z.enum(['active', 'disabled']).optional().catch(undefined),
})

function TenantRolesRoute() {
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId/roles' })
  return <TenantRolesPage key={tenantId} />
}

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/roles')({
  validateSearch: rolesSearchSchema,
  component: TenantRolesRoute,
})
