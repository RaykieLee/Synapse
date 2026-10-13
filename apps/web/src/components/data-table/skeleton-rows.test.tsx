import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { setLocale } from '@/lib/i18n'
import { DataTableSkeletonRows } from './skeleton-rows'

describe('DataTableSkeletonRows', () => {
  beforeEach(() => setLocale('en'))
  afterEach(() => {
    document.body.innerHTML = ''
    setLocale('zh-CN')
  })

  it('renders three compact placeholder rows by default', async () => {
    await render(
      <table>
        <tbody>
          <DataTableSkeletonRows columnCount={4} />
        </tbody>
      </table>
    )

    const rows = document.querySelectorAll('tbody > tr')
    expect(rows).toHaveLength(3)
    rows.forEach((row) => {
      expect(row.querySelectorAll('td')).toHaveLength(4)
      expect(row.className).toContain('h-10')
    })
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      'Loading'
    )
  })
})
