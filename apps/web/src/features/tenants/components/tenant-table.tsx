import { type SetStateAction } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Archive,
  ArrowUpRight,
  Eye,
  MoreHorizontal,
  Pause,
  Play,
} from 'lucide-react'
import type { Tenant, TenantStatus } from '@/api/tenants'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime, tenantText } from '../types'
import { EmptyState, TableSkeleton } from './shared'

const statusStyles: Record<TenantStatus, string> = {
  active:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  suspended:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  archived:
    'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
}

export function StatusBadge({ status }: { status: TenantStatus }) {
  return (
    <Badge variant='outline' className={statusStyles[status]}>
      {tenantText[status]}
    </Badge>
  )
}

export function TenantToolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
}: {
  query: string
  onQueryChange: (value: SetStateAction<string>) => void
  status: TenantStatus | ''
  onStatusChange: (value: SetStateAction<TenantStatus | ''>) => void
}) {
  return (
    <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
      <Input
        value={query}
        placeholder='搜索租户名称'
        className='h-10 w-full bg-background/80 sm:max-w-72'
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <Select
        value={status || 'all'}
        onValueChange={(value) =>
          onStatusChange(value === 'all' ? '' : (value as TenantStatus))
        }
      >
        <SelectTrigger className='h-10 w-full bg-background/80 sm:w-36'>
          <SelectValue placeholder='全部状态' />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='all'>全部状态</SelectItem>
          <SelectItem value='active'>启用</SelectItem>
          <SelectItem value='suspended'>已停用</SelectItem>
          <SelectItem value='archived'>已归档</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

export function TenantTable({
  tenants,
  isAdmin,
  loading,
  onStatusChange,
  onArchive,
}: {
  tenants: Tenant[]
  isAdmin: boolean
  loading: boolean
  onStatusChange: (tenant: Tenant) => void
  onArchive: (tenant: Tenant) => void
}) {
  const columnCount = isAdmin ? 5 : 4

  return (
    <div className='overflow-hidden border-t'>
      <Table>
        <TableHeader>
          <TableRow className='bg-muted/35 hover:bg-muted/35'>
            <TableHead className='h-11 ps-4'>租户</TableHead>
            <TableHead>标识</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className='hidden lg:table-cell'>有效期</TableHead>
            {!isAdmin ? <TableHead>我的角色</TableHead> : null}
            <TableHead className='hidden xl:table-cell'>创建时间</TableHead>
            <TableHead className='w-20 pe-4 text-end'>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={columnCount} className='p-0'>
                <TableSkeleton columns={5} />
              </TableCell>
            </TableRow>
          ) : tenants.length ? (
            tenants.map((tenant) => (
              <TableRow key={tenant.tenant_id} className='group'>
                <TableCell className='max-w-72 ps-4'>
                  <div className='space-y-0.5'>
                    <Link
                      to='/tenants/$tenantId'
                      params={{ tenantId: tenant.tenant_id }}
                      className='font-medium hover:text-primary'
                    >
                      {tenant.name}
                    </Link>
                    <p className='text-xs text-muted-foreground'>
                      {tenant.tenant_id}
                    </p>
                  </div>
                </TableCell>
                <TableCell className='font-mono text-xs text-muted-foreground'>
                  {tenant.slug}
                </TableCell>
                <TableCell>
                  <StatusBadge status={tenant.status} />
                </TableCell>
                <TableCell className='hidden max-w-56 text-xs text-muted-foreground lg:table-cell'>
                  {formatDateRangeCell(tenant)}
                </TableCell>
                {!isAdmin ? (
                  <TableCell>
                    {tenantText[tenant.tenant_role ?? 'member']}
                  </TableCell>
                ) : null}
                <TableCell className='hidden text-xs text-muted-foreground xl:table-cell'>
                  {formatDateTime(tenant.created_at)}
                </TableCell>
                <TableCell className='pe-4'>
                  <div className='flex items-center justify-end gap-1'>
                    <Button
                      asChild
                      variant='ghost'
                      size='icon'
                      className='size-8 lg:hidden'
                    >
                      <Link
                        to='/tenants/$tenantId'
                        params={{ tenantId: tenant.tenant_id }}
                        aria-label={`查看 ${tenant.name}`}
                      >
                        <Eye className='size-4' />
                      </Link>
                    </Button>
                    {isAdmin && tenant.status !== 'archived' ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='size-8'
                            aria-label={`操作 ${tenant.name}`}
                          >
                            <MoreHorizontal className='size-4' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end' className='w-40'>
                          <DropdownMenuItem asChild>
                            <Link
                              to='/tenants/$tenantId'
                              params={{ tenantId: tenant.tenant_id }}
                            >
                              <Eye className='size-4' /> 查看详情
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onStatusChange(tenant)}
                          >
                            {tenant.status === 'active' ? (
                              <Pause className='size-4' />
                            ) : (
                              <Play className='size-4' />
                            )}
                            {tenant.status === 'active'
                              ? '停用租户'
                              : '重新启用'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant='destructive'
                            onClick={() => onArchive(tenant)}
                          >
                            <Archive className='size-4' /> 归档租户
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                    {isAdmin && tenant.status === 'archived' ? (
                      <span className='text-xs text-muted-foreground'>
                        已终态
                      </span>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow className='hover:bg-transparent'>
              <TableCell colSpan={columnCount} className='p-4'>
                <EmptyState
                  title='暂无租户'
                  description='调整搜索条件或创建新的租户。'
                />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function formatDateRangeCell(tenant: Tenant) {
  if (!tenant.valid_from && !tenant.valid_until) return '长期有效'
  const from = tenant.valid_from
    ? new Date(tenant.valid_from).toLocaleDateString('zh-CN')
    : '不限'
  const until = tenant.valid_until
    ? new Date(tenant.valid_until).toLocaleDateString('zh-CN')
    : '不限'
  return `${from} ~ ${until}`
}

export function TablePager({
  page,
  pages,
  total,
  onPrevious,
  onNext,
}: {
  page: number
  pages: number
  total: number
  onPrevious: () => void
  onNext: () => void
}) {
  return (
    <div className='flex flex-col gap-3 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between'>
      <p className='text-muted-foreground'>共 {total} 个租户</p>
      <div className='flex items-center gap-2'>
        <Button
          variant='outline'
          size='sm'
          disabled={page <= 1}
          onClick={onPrevious}
        >
          上一页
        </Button>
        <span className='min-w-16 text-center font-medium'>
          {page} / {pages}
        </span>
        <Button
          variant='outline'
          size='sm'
          disabled={page >= pages}
          onClick={onNext}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}

export function TenantLinkIcon() {
  return <ArrowUpRight className='size-4' />
}
