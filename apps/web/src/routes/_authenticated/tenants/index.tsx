import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { Tenants } from '@/features/tenants'

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    const parsed = new Date(year, month - 1, day)
    return (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    )
  })
  .optional()
  .catch(undefined)
const tenantsSearchSchema = z.object({
  page: z.number().int().min(1).optional().catch(1),
  pageSize: z
    .union([z.literal(10), z.literal(20), z.literal(30), z.literal(50)])
    .optional()
    .catch(20),
  q: z.string().max(120).optional().catch(''),
  status: z
    .enum(['active', 'suspended', 'archived'])
    .optional()
    .catch(undefined),
  validity: z
    .enum(['current', 'not_started', 'expired', 'unlimited'])
    .optional()
    .catch(undefined),
  slug: z.string().max(64).optional().catch(''),
  createdFrom: date,
  createdTo: date,
  updatedFrom: date,
  expiresBefore: date,
})

export const Route = createFileRoute('/_authenticated/tenants/')({
  validateSearch: tenantsSearchSchema,
  component: Tenants,
})
