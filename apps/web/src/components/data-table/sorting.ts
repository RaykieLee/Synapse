export type TableSortState = {
  key: string
  direction: 'asc' | 'desc'
} | null

export function sortRows<T>(
  rows: readonly T[],
  sorting: TableSortState,
  getValue: (row: T, key: string) => unknown
): T[] {
  if (!sorting) return [...rows]

  return [...rows].sort((left, right) => {
    const leftValue = getValue(left, sorting.key)
    const rightValue = getValue(right, sorting.key)
    const comparison = compareValues(leftValue, rightValue)

    if (comparison === 0) return 0
    if (leftValue == null) return 1
    if (rightValue == null) return -1
    return sorting.direction === 'desc' ? -comparison : comparison
  })
}

function compareValues(left: unknown, right: unknown): number {
  if (left == null || right == null) {
    if (left == null && right == null) return 0
    return left == null ? 1 : -1
  }

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }

  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}
