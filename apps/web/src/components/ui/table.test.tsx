import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { Checkbox } from './checkbox'
import { Table, TableCell, TableHead, TableRow } from './table'

describe('Table', () => {
  it('uses compact, aligned cells for checkbox columns', async () => {
    await render(
      <Table>
        <thead>
          <TableRow>
            <TableHead>
              <Checkbox aria-label='Select all' />
            </TableHead>
          </TableRow>
        </thead>
        <tbody>
          <TableRow>
            <TableCell>
              <Checkbox aria-label='Select row' />
            </TableCell>
          </TableRow>
        </tbody>
      </Table>
    )

    const cells = document.querySelectorAll('th, td')
    expect(cells).toHaveLength(2)
    cells.forEach((cell) => {
      expect(cell.className).toContain('h-10')
      expect(cell.className).toContain('[&:has([role=checkbox])]:pr-0')
      expect(cell.className).toContain('[&>[role=checkbox]]:translate-y-[2px]')
    })
  })
})
