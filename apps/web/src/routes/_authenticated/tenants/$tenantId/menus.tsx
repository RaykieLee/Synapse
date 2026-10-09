import { createFileRoute } from '@tanstack/react-router'
import { TenantMenusPage } from '@/features/tenants/menus-page'

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/menus')({
  component: TenantMenusPage,
})
