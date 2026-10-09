import { createFileRoute } from '@tanstack/react-router'
import { TenantConfigsPage } from '@/features/tenants/configs-page'

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/configs')({ component: TenantConfigsPage })
