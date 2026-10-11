import { CalendarRange, Pencil, Shield } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime, formatDateRange, tenantText } from '../types'
import { StatusBadge } from './tenant-table'
import { LocalizedText } from '@/components/localized-text'

export function TenantSummaryCard({
  tenant,
  roleText,
}: {
  tenant: {
    tenant_id: string
    slug: string
    status: 'active' | 'suspended' | 'archived'
    valid_from: string | null
    valid_until: string | null
    membership_version: number
    created_at: string
    updated_at: string
  }
  roleText?: string
}) {
  return (
    <Card className='overflow-hidden'>
      <CardHeader className='border-b bg-gradient-to-br from-primary/5 via-card to-emerald-50/70 pb-5 dark:to-emerald-950/40'>
        <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
          <div className='space-y-2'>
            <div className='flex flex-wrap items-center gap-2'>
              <StatusBadge status={tenant.status} />
              {roleText ? <Badge variant='outline'>{roleText}</Badge> : null}
              <Badge variant='secondary' className='font-mono'>
                {tenant.slug}
              </Badge>
            </div>
            <p className='text-xs text-muted-foreground'>
              <LocalizedText text={"\n              租户 ID："} />{tenant.tenant_id}
            </p>
          </div>
          <div className='flex items-center gap-2 rounded-lg border bg-background/70 px-3 py-2 text-xs text-muted-foreground'>
            <CalendarRange className='size-4' />
            {formatDateRange(tenant.valid_from, tenant.valid_until)}
          </div>
        </div>
      </CardHeader>
      <CardContent className='grid gap-x-6 gap-y-4 pt-5 sm:grid-cols-2 xl:grid-cols-4'>
        <SummaryItem
          label='有效期开始'
          value={formatDateTime(tenant.valid_from)}
        />
        <SummaryItem
          label='有效期结束'
          value={formatDateTime(tenant.valid_until)}
        />
        <SummaryItem
          label='创建时间'
          value={formatDateTime(tenant.created_at)}
        />
        <SummaryItem
          label='更新时间'
          value={formatDateTime(tenant.updated_at)}
        />
      </CardContent>
    </Card>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className='space-y-1 rounded-lg bg-muted/20 px-3 py-2'>
      <p className='text-xs text-muted-foreground'><LocalizedText text={label} /></p>
      <p className='text-sm font-medium'>{value}</p>
    </div>
  )
}

export function TenantManagementLinks({
  links,
}: {
  links: { to: string; label: string }[]
}) {
  return (
    <Card>
      <CardHeader className='pb-3'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Shield className='size-4 text-muted-foreground' />
          <LocalizedText text={"\n          租户配置\n        "} /></CardTitle>
      </CardHeader>
      <CardContent className='space-y-1'>
        {links.map((link) => (
          <a
            key={link.to}
            href={link.to}
            className='flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted'
          >
            {link.label}
            <Pencil className='size-4 text-muted-foreground' />
          </a>
        ))}
      </CardContent>
    </Card>
  )
}

export function TenantRoleText(role: string | null) {
  return role ? tenantText[role as keyof typeof tenantText] : undefined
}
