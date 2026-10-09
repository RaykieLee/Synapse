import { createFileRoute } from '@tanstack/react-router'
import { Tenants } from '@/features/tenants'

export const Route = createFileRoute('/_authenticated/tenants/')({ component: Tenants })
