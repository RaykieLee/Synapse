import type { ReactNode } from 'react'
import { ArrowDown, ArrowDownUp, ArrowUp } from 'lucide-react'
import { useLocaleText } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { TableHead } from '@/components/ui/table'
import { LocalizedText } from '@/components/localized-text'
import type { TableSortState } from './sorting'

export function SortableTableHead({
  label,
  sortKey,
  sorting,
  onSortingChange,
  className,
}: {
  label: ReactNode
  sortKey: string
  sorting: TableSortState
  onSortingChange: (next: TableSortState) => void
  className?: string
}) {
  const t = useLocaleText()
  const direction = sorting?.key === sortKey ? sorting.direction : null

  const toggleSort = () => {
    if (direction === null) {
      onSortingChange({ key: sortKey, direction: 'asc' })
    } else if (direction === 'asc') {
      onSortingChange({ key: sortKey, direction: 'desc' })
    } else {
      onSortingChange(null)
    }
  }

  return (
    <TableHead
      aria-sort={
        direction === 'asc'
          ? 'ascending'
          : direction === 'desc'
            ? 'descending'
            : 'none'
      }
      className={className}
    >
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='-ml-2 h-8 min-w-0 gap-1.5 px-2 font-medium'
        title={t(
          direction === 'asc'
            ? '当前升序，点击切换为降序'
            : direction === 'desc'
              ? '当前降序，点击清除排序'
              : '点击按此列升序排序'
        )}
        onClick={toggleSort}
      >
        {label}
        {direction === 'asc' ? (
          <ArrowUp aria-hidden='true' className='size-3.5' />
        ) : direction === 'desc' ? (
          <ArrowDown aria-hidden='true' className='size-3.5' />
        ) : (
          <ArrowDownUp
            aria-hidden='true'
            className='size-3.5 text-muted-foreground/70'
          />
        )}
        <span className='sr-only'>
          <LocalizedText text='切换排序' />
        </span>
      </Button>
    </TableHead>
  )
}
