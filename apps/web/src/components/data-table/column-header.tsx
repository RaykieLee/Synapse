import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretSortIcon,
} from '@radix-ui/react-icons'
import { type Column } from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type DataTableColumnHeaderProps<TData, TValue> =
  React.HTMLAttributes<HTMLDivElement> & {
    column: Column<TData, TValue>
    title: string
  }

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn(className)}>{title}</div>
  }

  return (
    <div className={cn('flex items-center space-x-2', className)}>
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='-ml-2 h-8 min-w-0 gap-1.5 px-2 font-medium'
        onClick={column.getToggleSortingHandler()}
        aria-label={`${title}, sort`}
      >
        <span>{title}</span>
        {column.getIsSorted() === 'desc' ? (
          <ArrowDownIcon className='size-3.5' />
        ) : column.getIsSorted() === 'asc' ? (
          <ArrowUpIcon className='size-3.5' />
        ) : (
          <CaretSortIcon className='size-3.5 text-muted-foreground/70' />
        )}
      </Button>
    </div>
  )
}
