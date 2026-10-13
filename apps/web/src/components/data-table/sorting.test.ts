import { describe, expect, it } from 'vitest'
import { sortRows } from './sorting'

describe('sortRows', () => {
  const rows = [
    { name: 'Team 10', rank: 10, inactive: null },
    { name: 'team 2', rank: 2, inactive: 'z' },
    { name: 'Team 1', rank: 1, inactive: 'a' },
  ]
  const valueFor = (row: (typeof rows)[number], key: string) =>
    row[key as keyof typeof row]

  it('sorts strings naturally without mutating the input', () => {
    const sorted = sortRows(rows, { key: 'name', direction: 'asc' }, valueFor)

    expect(sorted.map((row) => row.name)).toEqual([
      'Team 1',
      'team 2',
      'Team 10',
    ])
    expect(rows[0].name).toBe('Team 10')
  })

  it('sorts numbers in descending order', () => {
    const sorted = sortRows(rows, { key: 'rank', direction: 'desc' }, valueFor)

    expect(sorted.map((row) => row.rank)).toEqual([10, 2, 1])
  })

  it('keeps null values last in either direction', () => {
    const sorted = sortRows(
      rows,
      { key: 'inactive', direction: 'desc' },
      valueFor
    )

    expect(sorted.map((row) => row.inactive)).toEqual(['z', 'a', null])
  })

  it('preserves the original order when sorting is cleared', () => {
    expect(sortRows(rows, null, valueFor)).toEqual(rows)
  })
})
