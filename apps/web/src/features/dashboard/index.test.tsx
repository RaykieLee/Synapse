import '@/styles/index.css'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { setLocale, translate } from '@/lib/i18n'
import { Dashboard } from './index'

afterEach(async () => {
  await cleanup()
  setLocale('zh-CN')
})

describe('dashboard placeholders', () => {
  it('shows unconfigured data sources with semantic headings and horizontal tabs', async () => {
    setLocale('en')
    const screen = await render(<Dashboard />)

    await expect
      .element(
        screen.getByRole('heading', {
          level: 1,
          name: 'Dashboard',
          exact: true,
        })
      )
      .toBeVisible()
    await expect
      .element(
        screen.getByRole('heading', {
          level: 2,
          name: 'Workspace summary',
          exact: true,
        })
      )
      .toBeVisible()
    await expect
      .element(
        screen.getByRole('heading', {
          level: 3,
          name: 'Workspace',
          exact: true,
        })
      )
      .toBeVisible()
    await expect
      .element(
        screen.getByRole('heading', {
          level: 2,
          name: 'Workspace overview',
          exact: true,
        })
      )
      .toBeVisible()
    await expect
      .element(
        screen.getByRole('heading', {
          level: 2,
          name: 'Workspace activity',
          exact: true,
        })
      )
      .toBeVisible()
    await expect
      .element(screen.getByRole('tablist'))
      .toHaveAttribute('aria-orientation', 'horizontal')
    await expect
      .element(screen.getByRole('tabpanel'))
      .toHaveTextContent("Workspace overview data isn't connected yet.")
    await expect
      .element(
        screen.getByText(
          "Workspace activity data isn't connected yet.",
          { exact: true }
        )
      )
      .toBeVisible()
    expect(document.body.textContent).toContain(
      'No workspace data source is configured, so metrics are unavailable.'
    )
    expect(document.body.textContent).not.toMatch(/\bconnect\b/i)

    expect(document.body.textContent).not.toMatch(
      /\$45,231\.89|\+2350|\+12,234|\+573|265 sales|Olivia Martin|Jackson Lee|1,248|832|42%/
    )

    await userEvent.click(
      screen.getByRole('tab', { name: 'Analytics', exact: true })
    )
    await expect
      .element(screen.getByRole('tabpanel'))
      .toHaveTextContent("Analytics data isn't connected yet.")
    await expect
      .element(
        screen.getByRole('heading', {
          level: 2,
          name: 'Workspace analytics',
          exact: true,
        })
      )
      .toBeVisible()
    await expect
      .element(
        screen.getByRole('heading', {
          level: 3,
          name: 'Data sources',
          exact: true,
        })
      )
      .toBeVisible()
    expect(
      await screen
        .getByRole('heading', {
          level: 4,
          name: "Analytics data isn't connected yet.",
          exact: true,
        })
        .elements()
    ).toHaveLength(2)
    expect(document.body.textContent).toContain(
      'No analytics data source is configured, so charts and breakdowns are unavailable.'
    )
    expect(document.body.textContent).not.toMatch(
      /Weekly clicks and unique visitors|Product Hunt|Twitter|3m 24s/
    )
    expect(document.body.textContent).not.toMatch(/\bconnect\b/i)

    setLocale('zh-CN')
    await expect
      .element(screen.getByRole('tabpanel'))
      .toHaveTextContent('分析数据尚未接入。')
    expect(translate("Workspace data isn't connected yet.", 'zh-CN')).toBe(
      '工作区数据尚未接入。'
    )
    expect(translate('工作区数据尚未接入。', 'en')).toBe(
      "Workspace data isn't connected yet."
    )
  })
})
