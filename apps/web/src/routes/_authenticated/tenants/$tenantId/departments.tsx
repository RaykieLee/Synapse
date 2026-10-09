import { createFileRoute } from '@tanstack/react-router'
import { TenantDepartmentsPage } from '@/features/tenants/departments-page'

export const Route = createFileRoute('/_authenticated/tenants/$tenantId/departments')({ component: TenantDepartmentsPage })
