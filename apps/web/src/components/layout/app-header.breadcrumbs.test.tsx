import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import '@/styles/index.css'
import { BreadcrumbTrail, routeBreadcrumbs } from './app-header'
import { setLocale } from '@/lib/i18n'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const React = await import('react')
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    Link: ({ to, ...props }: any) =>
      React.createElement('a', { ...props, href: String(to) }),
    useRouterState: () => '/settings',
  }
})

const tenant = { name: 'Tenant Alpha', member: true }
const workspace = { name: 'Research Workspace', tenantId: 'tenant-1' }
const tenantById = (id: string) => (id === 'tenant-1' ? tenant : undefined)
const workspaceById = (id: string) =>
  id === 'workspace-1' ? workspace : undefined

describe('global navigation breadcrumbs', () => {
  beforeEach(() => {
    setLocale('en')
  })

  it('restores personal, platform, tenant, and Workspace ancestors', () => {
    expect(
      routeBreadcrumbs('/settings/account', false, tenantById, workspaceById).map(
        (item) => item.title
      )
    ).toEqual(['个人', '个人设置', '账号'])
    expect(
      routeBreadcrumbs('/users', true, tenantById, workspaceById).map(
        (item) => item.title
      )
    ).toEqual(['平台管理', '全局用户'])
    expect(
      routeBreadcrumbs('/tenants/tenant-1/members', false, tenantById, workspaceById).map(
        (item) => item.title
      )
    ).toEqual(['个人', '我的租户', 'Tenant Alpha', '成员与邀请'])
    expect(
      routeBreadcrumbs('/tenants/tenant-1/roles', true, tenantById, workspaceById).map(
        (item) => item.title
      )
    ).toEqual(['平台管理', '平台租户目录', 'Tenant Alpha', '角色管理'])
    expect(
      routeBreadcrumbs('/w/workspace-1/chat', false, tenantById, workspaceById).map(
        (item) => item.title
      )
    ).toEqual([
      'Tenant Alpha',
      'Research Workspace',
      'Workspace 工作台',
      'AI 对话',
    ])
  })

  it('keeps middle breadcrumb ancestors keyboard-accessible at 320px', async () => {
    await page.viewport(320, 844)
    const breadcrumbs = routeBreadcrumbs(
      '/tenants/tenant-1/roles/permission-rules',
      true,
      tenantById,
      workspaceById
    )
    const screen = await render(
      <BreadcrumbTrail
        breadcrumbs={breadcrumbs}
        locale='en'
        announcement='Tenant Alpha role permission rules'
      />
    )
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const middleAncestor = screen.getByRole('link', {
      name: 'Role management',
    })

    for (let index = 0; index < 5; index += 1) {
      if (document.activeElement === middleAncestor.element()) break
      await userEvent.tab()
    }
    await expect.element(middleAncestor).toHaveFocus()
    expect(middleAncestor.element().className).toContain('focus-visible:outline')
    expect(nav.element().scrollWidth).toBeGreaterThan(nav.element().clientWidth)
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('Tenant Alpha role permission rules')
  })
})
