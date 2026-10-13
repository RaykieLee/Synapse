import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableRow } from '@/components/ui/table'
import { LocalizedText } from '@/components/localized-text'

const widths = ['w-3/5', 'w-4/5', 'w-1/2', 'w-2/3']

export function DataTableSkeletonRows({
  columnCount,
  rowCount = 3,
}: {
  columnCount: number
  rowCount?: number
}) {
  return Array.from({ length: rowCount }, (_, rowIndex) => (
    <TableRow
      key={`skeleton-row-${rowIndex}`}
      aria-busy={rowIndex === 0 ? 'true' : undefined}
      aria-hidden={rowIndex === 0 ? undefined : 'true'}
      className='hover:bg-transparent'
    >
      {Array.from({ length: columnCount }, (_, columnIndex) => (
        <TableCell key={`skeleton-cell-${rowIndex}-${columnIndex}`}>
          {rowIndex === 0 && columnIndex === 0 ? (
            <span role='status' className='sr-only'>
              <LocalizedText text='正在加载…' />
            </span>
          ) : null}
          <Skeleton
            aria-hidden='true'
            className={`h-4 ${widths[(rowIndex + columnIndex) % widths.length]}`}
          />
        </TableCell>
      ))}
    </TableRow>
  ))
}
