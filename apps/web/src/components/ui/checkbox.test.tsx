import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { Checkbox } from './checkbox'

describe('Checkbox', () => {
  it('uses the compact 16px control size', async () => {
    await render(<Checkbox aria-label='Select row' />)

    const checkbox = document.querySelector('[role="checkbox"]')
    expect(checkbox?.className).toContain('size-4')
  })
})
