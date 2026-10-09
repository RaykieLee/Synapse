import { createFileRoute, useParams } from '@tanstack/react-router'
import { TenantDictionariesPage } from '@/features/tenants/dictionaries-page'

function TenantDictionariesRoute() {
  const { tenantId } = useParams({ from: '/_authenticated/tenants/$tenantId/dictionaries' })
  return <TenantDictionariesPage key={tenantId} />
}

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/dictionaries')({
  component: TenantDictionariesRoute,
})
