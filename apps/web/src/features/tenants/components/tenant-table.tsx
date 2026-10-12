import { useState } from 'react'
import { CheckIcon, PlusCircledIcon } from '@radix-ui/react-icons'
import { Link } from '@tanstack/react-router'
import {
  Archive,
  ArrowUpRight,
  Eye,
  Filter,
  MoreHorizontal,
  Pause,
  Play,
  X,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
} from 'lucide-react'
import type { Tenant, TenantStatus, TenantValidity } from '@/api/tenants'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  formatDateRange,
  formatDateTime,
  localizedTenantText,
} from '../types'
import { EmptyState, TableSkeleton } from './shared'
import { LocalizedText } from '@/components/localized-text'
import { useLocale, useLocaleText } from '@/lib/i18n'

const statusStyles: Record<TenantStatus, string> = {
  active:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  suspended:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  archived:
    'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
}

export function StatusBadge({ status }: { status: TenantStatus }) {
  const locale = useLocale()
  return (
    <Badge variant='outline' className={statusStyles[status]}>
      {localizedTenantText(status, locale)}
    </Badge>
  )
}

function TenantFacetFilter<T extends string>({
  title,
  value,
  options,
  onChange,
  disabled = false,
}: {
  title: string
  value: T | ''
  options: { value: T; label: string }[]
  onChange: (value: T | '') => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [wasDisabled, setWasDisabled] = useState(disabled)
  if (disabled !== wasDisabled) {
    setWasDisabled(disabled)
    if (disabled) setOpen(false)
  }
  const selected = options.find((option) => option.value === value)
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!disabled) setOpen(nextOpen)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          className='h-8 border-dashed'
        >
          <PlusCircledIcon className='size-4' />
          {title}
          {selected ? (
            <>
              <Separator orientation='vertical' className='mx-1 h-4' />
              <Badge
                variant='secondary'
                className='rounded-sm px-1 font-normal'
              >
                {selected.label}
              </Badge>
            </>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-48 p-0' align='start'>
        <Command>
          <CommandList>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  disabled={disabled}
                  onSelect={() =>
                    onChange(value === option.value ? '' : option.value)
                  }
                >
                  <span
                    className={cn(
                      'flex size-4 items-center justify-center rounded-sm border border-primary',
                      value === option.value
                        ? 'bg-primary text-primary-foreground'
                        : 'opacity-50 [&_svg]:invisible'
                    )}
                  >
                    <CheckIcon className='size-4' />
                  </span>
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {selected ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    className='justify-center'
                    disabled={disabled}
                    onSelect={() => onChange('')}
                  >
                    <LocalizedText text={"\n                    清除筛选\n                  "} /></CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function TenantToolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  validity,
  onValidityChange,
  createdFrom,
  createdTo,
  slug,
  updatedFrom,
  expiresBefore,
  onAdvancedChange,
  onReset,
  isAdmin,
  disabled = false,
}: {
  query: string
  onQueryChange: (value: string) => void
  status: TenantStatus | ''
  onStatusChange: (value: TenantStatus | '') => void
  validity: TenantValidity | ''
  onValidityChange: (value: TenantValidity | '') => void
  createdFrom: string
  createdTo: string
  slug: string
  updatedFrom: string
  expiresBefore: string
  onAdvancedChange: (values: AdvancedTenantFilters) => void
  onReset: () => void
  isAdmin: boolean
  disabled?: boolean
}) {
  const t = useLocaleText()
  const [dateOpen, setDateOpen] = useState(false)
  const [wasDisabled, setWasDisabled] = useState(disabled)
  const [draft, setDraft] = useState<AdvancedTenantFilters>({
    slug,
    createdFrom,
    createdTo,
    updatedFrom,
    expiresBefore,
  })
  const advancedCount = [
    slug,
    createdFrom || createdTo,
    updatedFrom,
    expiresBefore,
  ].filter(Boolean).length
  const hasFilters = Boolean(query || status || validity || advancedCount)

  if (disabled !== wasDisabled) {
    setWasDisabled(disabled)
    if (disabled) setDateOpen(false)
  }

  return (
    <div
      role='toolbar'
      aria-label={t('租户筛选')}
      className='flex flex-wrap items-center gap-2'
    >
      <Input
        value={query}
        aria-label={t('搜索租户')}
        placeholder={t('搜索名称、标识或 ID')}
        className='h-8 w-full sm:w-64'
        disabled={disabled}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {isAdmin ? (
        <TenantFacetFilter
          title={t('状态')}
          value={status}
          onChange={onStatusChange}
          disabled={disabled}
          options={[
            { value: 'active', label: t('启用') },
            { value: 'suspended', label: t('已停用') },
            { value: 'archived', label: t('已归档') },
          ]}
        />
      ) : null}
      <TenantFacetFilter
        title={t('有效期')}
        value={validity}
        onChange={onValidityChange}
        disabled={disabled}
        options={[
          { value: 'current', label: t('当前有效') },
          { value: 'not_started', label: t('未开始') },
          { value: 'expired', label: t('已过期') },
          { value: 'unlimited', label: t('长期有效') },
        ]}
      />
      <Popover
        open={dateOpen}
        onOpenChange={(open) => {
          if (disabled) return
          if (open)
            setDraft({
              slug,
              createdFrom,
              createdTo,
              updatedFrom,
              expiresBefore,
            })
          setDateOpen(open)
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-8 border-dashed'
            disabled={disabled}
          >
            <Filter className='size-4' />
            {t('更多筛选')}{advancedCount ? ` · ${advancedCount}` : ''}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align='start'
          className='w-80 max-w-[calc(100vw-2rem)] p-4'
        >
          <div className='space-y-3'>
            <label className='block space-y-1 text-sm'>
              <span className='font-medium'>{t('租户标识')}</span>
              <Input
                value={draft.slug}
                disabled={disabled}
                placeholder={t('精确匹配，例如 acme')}
                onChange={(event) =>
                  setDraft({ ...draft, slug: event.target.value })
                }
              />
            </label>
            <div className='space-y-1'>
              <span className='text-sm font-medium'>{t('创建时间')}</span>
              <div className='grid grid-cols-2 gap-2'>
                <Input
                  type='date'
                  aria-label={t('创建时间起始')}
                  value={draft.createdFrom}
                  disabled={disabled}
                  max={draft.createdTo || undefined}
                  onChange={(event) =>
                    setDraft({ ...draft, createdFrom: event.target.value })
                  }
                />
                <Input
                  type='date'
                  aria-label={t('创建时间结束')}
                  value={draft.createdTo}
                  disabled={disabled}
                  min={draft.createdFrom || undefined}
                  onChange={(event) =>
                    setDraft({ ...draft, createdTo: event.target.value })
                  }
                />
              </div>
            </div>
            <div className='flex flex-wrap gap-2'>
              {[7, 30].map((days) => (
                <Button
                  key={days}
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={disabled}
                  onClick={() => {
                    const today = new Date()
                    const from = new Date(
                      today.getFullYear(),
                      today.getMonth(),
                      today.getDate() - days + 1
                    )
                    setDraft({
                      ...draft,
                      createdFrom: formatLocalDate(from),
                      createdTo: formatLocalDate(today),
                    })
                  }}
                >
                  {t('最近')} {days} {t('天')}</Button>
              ))}
            </div>
            <label className='block space-y-1 text-sm'>
              <span className='font-medium'>{t('最近更新不早于')}</span>
              <Input
                type='date'
                value={draft.updatedFrom}
                disabled={disabled}
                onChange={(event) =>
                  setDraft({ ...draft, updatedFrom: event.target.value })
                }
              />
            </label>
            <label className='block space-y-1 text-sm'>
              <span className='font-medium'>{t('到期时间不晚于')}</span>
              <Input
                type='date'
                value={draft.expiresBefore}
                disabled={disabled}
                onChange={(event) =>
                  setDraft({ ...draft, expiresBefore: event.target.value })
                }
              />
            </label>
            <div className='flex justify-between border-t pt-3'>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={disabled}
                onClick={() => {
                  const empty = {
                    slug: '',
                    createdFrom: '',
                    createdTo: '',
                    updatedFrom: '',
                    expiresBefore: '',
                  }
                  setDraft(empty)
                  onAdvancedChange(empty)
                  setDateOpen(false)
                }}
              >
                {t('清空')}</Button>
              <Button
                type='button'
                size='sm'
                disabled={Boolean(
                  disabled ||
                  (draft.createdFrom &&
                    draft.createdTo &&
                    draft.createdFrom > draft.createdTo)
                )}
                onClick={() => {
                  onAdvancedChange({ ...draft, slug: draft.slug.trim() })
                  setDateOpen(false)
                }}
              >
                {t('应用筛选')}</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {hasFilters ? (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-8'
          onClick={onReset}
        >
          <X className='size-4' /> <LocalizedText text={" 重置\n        "} /></Button>
      ) : null}
    </div>
  )
}

type AdvancedTenantFilters = {
  slug: string
  createdFrom: string
  createdTo: string
  updatedFrom: string
  expiresBefore: string
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function TenantTable({
  tenants,
  isAdmin,
  loading,
  onStatusChange,
  onArchive,
  selectedIds,
  onSelectionChange,
  visibleColumns,
  hasFilters,
  selectionDisabled = false,
}: {
  tenants: Tenant[]
  isAdmin: boolean
  loading: boolean
  onStatusChange: (tenant: Tenant) => void
  onArchive: (tenant: Tenant) => void
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  visibleColumns: Set<TenantColumn>
  hasFilters: boolean
  selectionDisabled?: boolean
}) {
  const locale = useLocale()
  const t = useLocaleText()
  const columns = tenantColumns.filter(
    (column) => column.key !== 'role' || !isAdmin
  )
  const columnCount =
    (isAdmin ? 3 : 2) +
    columns.filter((column) => visibleColumns.has(column.key)).length
  const selectableTenants = tenants.filter(
    (tenant) => tenant.status !== 'archived'
  )
  const allSelected =
    selectableTenants.length > 0 &&
    selectableTenants.every((tenant) => selectedIds.has(tenant.tenant_id))
  const someSelected = selectableTenants.some((tenant) =>
    selectedIds.has(tenant.tenant_id)
  )
  const toggleAll = (checked: boolean) => {
    const next = new Set(selectedIds)
    for (const tenant of selectableTenants) {
      if (checked) next.add(tenant.tenant_id)
      else next.delete(tenant.tenant_id)
    }
    onSelectionChange(next)
  }

  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow className='bg-muted/35 hover:bg-muted/35'>
            {isAdmin ? (
              <TableHead className='w-10 ps-4'>
                <Checkbox
                  aria-label={t('选择当前页全部可操作租户')}
                  checked={
                    allSelected ? true : someSelected ? 'indeterminate' : false
                  }
                  disabled={selectionDisabled || selectableTenants.length === 0}
                  onCheckedChange={(value) => toggleAll(value === true)}
                />
              </TableHead>
            ) : null}
            <TableHead className='h-11 ps-4'><LocalizedText text={"租户"} /></TableHead>
            {visibleColumns.has('slug') ? <TableHead><LocalizedText text={"标识"} /></TableHead> : null}
            {visibleColumns.has('status') ? <TableHead><LocalizedText text={"状态"} /></TableHead> : null}
            {visibleColumns.has('validity') ? (
              <TableHead><LocalizedText text={"有效期"} /></TableHead>
            ) : null}
            {!isAdmin && visibleColumns.has('role') ? (
              <TableHead><LocalizedText text={"我的角色"} /></TableHead>
            ) : null}
            {visibleColumns.has('created') ? (
              <TableHead><LocalizedText text={"创建时间"} /></TableHead>
            ) : null}
            <TableHead className='w-20 pe-4 text-end'><LocalizedText text={"操作"} /></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={columnCount} className='p-0'>
                <div role='status' aria-live='polite' aria-busy='true'>
                  <span className='sr-only'>{t('正在加载租户列表…')}</span>
                  <TableSkeleton columns={columnCount} />
                </div>
              </TableCell>
            </TableRow>
          ) : tenants.length ? (
            tenants.map((tenant) => (
              <TableRow
                key={tenant.tenant_id}
                className='group'
                data-state={
                  selectedIds.has(tenant.tenant_id) ? 'selected' : undefined
                }
              >
                {isAdmin ? (
                  <TableCell className='ps-4'>
                    <Checkbox
                      aria-label={locale === 'en' ? `Select tenant ${tenant.name}` : `选择租户 ${tenant.name}`}
                      checked={selectedIds.has(tenant.tenant_id)}
                      disabled={selectionDisabled || tenant.status === 'archived'}
                      onCheckedChange={(value) => {
                        const next = new Set(selectedIds)
                        if (value === true && tenant.status !== 'archived') next.add(tenant.tenant_id)
                        else next.delete(tenant.tenant_id)
                        onSelectionChange(next)
                      }}
                    />
                  </TableCell>
                ) : null}
                <TableCell className='max-w-72 ps-4'>
                  <div className='space-y-0.5'>
                    <Link
                      to='/tenants/$tenantId'
                      params={{ tenantId: tenant.tenant_id }}
                      className='font-medium hover:text-primary'
                    >
                      {tenant.name}
                    </Link>
                  </div>
                </TableCell>
                {visibleColumns.has('slug') ? (
                  <TableCell className='font-mono text-xs text-muted-foreground'>
                    {tenant.slug}
                  </TableCell>
                ) : null}
                {visibleColumns.has('status') ? (
                  <TableCell>
                    <StatusBadge status={tenant.status} />
                  </TableCell>
                ) : null}
                {visibleColumns.has('validity') ? (
                  <TableCell className='max-w-56 text-xs text-muted-foreground'>
                    {formatDateRangeCell(tenant, locale)}
                  </TableCell>
                ) : null}
                {!isAdmin && visibleColumns.has('role') ? (
                  <TableCell>
                    {localizedTenantText(tenant.tenant_role ?? 'member', locale)}
                  </TableCell>
                ) : null}
                {visibleColumns.has('created') ? (
                  <TableCell className='text-xs text-muted-foreground'>
                    {formatDateTime(tenant.created_at, locale)}
                  </TableCell>
                ) : null}
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
                        aria-label={
                          locale === 'en'
                            ? `View ${tenant.name}`
                            : `查看 ${tenant.name}`
                        }
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
                            aria-label={
                              locale === 'en'
                                ? `Actions for ${tenant.name}`
                                : `操作 ${tenant.name}`
                            }
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
                              <Eye className='size-4' /> <LocalizedText text={" 查看详情\n                            "} /></Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={selectionDisabled}
                            onClick={() => onStatusChange(tenant)}
                          >
                            {tenant.status === 'active' ? (
                              <Pause className='size-4' />
                            ) : (
                              <Play className='size-4' />
                            )}
                            {tenant.status === 'active' ? <LocalizedText text={"停用租户"} /> : <LocalizedText text={"重新启用"} />}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant='destructive'
                            disabled={selectionDisabled}
                            onClick={() => onArchive(tenant)}
                          >
                            <Archive className='size-4' /> <LocalizedText text={" 归档租户\n                          "} /></DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                    {isAdmin && tenant.status === 'archived' ? (
                      <span className='text-xs text-muted-foreground'>
                        <LocalizedText text={"\n                        已终态\n                      "} /></span>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow className='hover:bg-transparent'>
              <TableCell colSpan={columnCount} className='p-4'>
                <EmptyState
                  title={
                    hasFilters
                      ? '没有匹配的租户'
                      : isAdmin
                        ? '暂无租户'
                        : '当前没有可访问的启用租户'
                  }
                  description={
                    hasFilters
                      ? '调整搜索条件或重置筛选。'
                      : isAdmin
                        ? '创建新的租户后，它会出现在此处。'
                        : '请联系租户管理员为你添加成员资格。'
                  }
                />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function formatDateRangeCell(
  tenant: Tenant,
  locale: Parameters<typeof formatDateTime>[1]
) {
  return formatDateRange(tenant.valid_from, tenant.valid_until, locale)
}

export function TablePager({
  page,
  pages,
  total,
  pageSize,
  selectedCount = 0,
  onPageChange,
  onPageSizeChange,
  onClearSelection,
  disabled = false,
}: {
  page: number
  pages: number
  total: number
  pageSize: number
  selectedCount?: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  onClearSelection?: () => void
  disabled?: boolean
}) {
  const locale = useLocale()
  const t = useLocaleText()
  const selectionSummary =
    locale === 'en'
      ? `${selectedCount} selected, ${total} total`
      : `已选择 ${selectedCount} 项，共 ${total} 项`
  const pageSummary =
    locale === 'en' ? `Page ${page} of ${pages}` : `第 ${page} 页，共 ${pages} 页`

  return (
    <div className='flex flex-col gap-3 border-t px-4 py-3 text-sm lg:flex-row lg:items-center lg:justify-between'>
      <div className='flex items-center gap-2 text-muted-foreground'>
        <span aria-live='polite'>{selectionSummary}</span>
        {selectedCount > 0 && onClearSelection ? (
          <Button variant='ghost' size='sm' disabled={disabled} onClick={onClearSelection}>
            {t('取消选择')}</Button>
        ) : null}
      </div>
      <div className='flex flex-wrap items-center gap-4'>
        {onPageSizeChange ? (
          <div className='flex items-center gap-2'>
            <span>{t('每页行数')}</span>
            <Select
              value={String(pageSize)}
              disabled={disabled}
              onValueChange={(value) => onPageSizeChange?.(Number(value))}
            >
              <SelectTrigger className='h-8 w-18' aria-label={t('每页行数')} disabled={disabled}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent side='top'>
                {[10, 20, 30, 50].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <span className='min-w-24 text-center' aria-live='polite'>{pageSummary}</span>
        <div className='flex items-center gap-1'>
          <Button
            variant='outline'
            size='icon'
            className='size-8'
            aria-label={t('跳到第一页')}
            disabled={disabled || page <= 1}
            onClick={() => onPageChange(1)}
          >
            <ChevronFirst className='size-4' />
          </Button>
          <Button
            variant='outline'
            size='icon'
            className='size-8'
            aria-label={t('上一页')}
            disabled={disabled || page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className='size-4' />
          </Button>
          <Button
            variant='outline'
            size='icon'
            className='size-8'
            aria-label={t('下一页')}
            disabled={disabled || page >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight className='size-4' />
          </Button>
          <Button
            variant='outline'
            size='icon'
            className='size-8'
            aria-label={t('跳到最后一页')}
            disabled={disabled || page >= pages}
            onClick={() => onPageChange(pages)}
          >
            <ChevronLast className='size-4' />
          </Button>
        </div>
      </div>
    </div>
  )
}

export const tenantColumns = [
  { key: 'slug', label: '标识' },
  { key: 'status', label: '状态' },
  { key: 'validity', label: '有效期' },
  { key: 'role', label: '我的角色' },
  { key: 'created', label: '创建时间' },
] as const
export type TenantColumn = (typeof tenantColumns)[number]['key']

export function TenantColumnOptions({
  visible,
  onChange,
  isAdmin,
  disabled = false,
}: {
  visible: Set<TenantColumn>
  onChange: (columns: Set<TenantColumn>) => void
  isAdmin: boolean
  disabled?: boolean
}) {
  const t = useLocaleText()
  const [open, setOpen] = useState(false)
  const [wasDisabled, setWasDisabled] = useState(disabled)
  if (disabled !== wasDisabled) {
    setWasDisabled(disabled)
    if (disabled) setOpen(false)
  }
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!disabled) setOpen(nextOpen)
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant='outline' size='sm' className='h-8' disabled={disabled}>
          <SlidersHorizontal className='size-4' />
          <LocalizedText text={"\n          显示列\n        "} /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuLabel><LocalizedText text={"显示列"} /></DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tenantColumns
          .filter((column) => !isAdmin || column.key !== 'role')
          .map((column) => (
            <DropdownMenuCheckboxItem
              key={column.key}
              checked={visible.has(column.key)}
              disabled={disabled}
              onCheckedChange={(checked) => {
                const next = new Set(visible)
                if (checked) next.add(column.key)
                else next.delete(column.key)
                onChange(next)
              }}
            >
              {t(column.label)}
            </DropdownMenuCheckboxItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TenantLinkIcon() {
  return <ArrowUpRight className='size-4' />
}
