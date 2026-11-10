import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { routeTree } from '@/routeTree.gen'
import '@/styles/index.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { LanguageSwitch } from '@/components/language-switch'
import { setLocale } from '@/lib/i18n'

vi.mock('@/lib/api', async (importOriginal) => {
  const api = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...api,
    restoreSession: vi
      .fn()
      .mockRejectedValue(new Error('No authenticated session in route test')),
  }
})

function renderRoute(initialEntries: string[], locale: 'zh-CN' | 'en' = 'en') {
  setLocale(locale)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries }),
  })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  return router
}

async function expectAliasReplacement(
  alias: string,
  destination: string,
  redirect?: string
) {
  const router = renderRoute(['/sign-up', alias])
  await vi.waitFor(() =>
    expect(router.state.location.pathname).toBe(destination)
  )
  if (redirect) {
    expect(router.state.location.search).toMatchObject({ redirect })
  }

  router.history.back()
  await vi.waitFor(() =>
    expect(router.state.location.pathname).toBe('/sign-up')
  )
}

describe('Clerk compatibility route cleanup', () => {
  afterEach(async () => {
    await cleanup()
    setLocale('zh-CN')
  })

  it('synchronizes a restored locale before the language switch mounts', async () => {
    setLocale('en')
    window.localStorage.setItem('synapse-locale', 'zh-CN')
    document.documentElement.lang = 'en'

    render(<LanguageSwitch />)

    await expect
      .element(page.getByRole('button', { name: '切换到 English' }))
      .toBeVisible()
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('renders the application 404 for an unknown nested Clerk path', async () => {
    const router = renderRoute(['/clerk/unknown/deep/path?source=bookmark'])

    await expect
      .element(
        page.getByRole('heading', {
          level: 1,
          name: 'Page not found or removed',
        })
      )
      .toBeVisible()
    await expect.element(page.getByRole('main')).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: 'Back to dashboard' }))
      .toHaveAttribute('href', '/')
    expect(router.state.location.pathname).toBe('/clerk/unknown/deep/path')
    expect(document.documentElement.lang).toBe('en')
  })

  it.each(['/tasks', '/apps', '/chats', '/help-center'])(
    'keeps the removed %s demo on the application 404',
    async (path) => {
      renderRoute([path], 'zh-CN')

      await expect
        .element(
          page.getByRole('heading', {
            level: 1,
            name: '页面不存在或已移除',
          })
        )
        .toBeVisible()
      await expect.element(page.getByRole('main')).toBeVisible()
      await expect
        .element(page.getByRole('link', { name: '返回工作台' }))
        .toHaveAttribute('href', '/')
      expect(document.documentElement.lang).toBe('zh-CN')
    }
  )

  it('preserves the /clerk sign-in and sign-up aliases', async () => {
    await expectAliasReplacement('/clerk', '/sign-in')
    await expectAliasReplacement(
      '/clerk/sign-in?redirect=%2Fsettings',
      '/sign-in',
      '/settings'
    )
    await expectAliasReplacement('/clerk/sign-up', '/sign-up')
    await expectAliasReplacement('/clerk/user-management', '/sign-in', '/users')
  })

  it('preserves the legacy sign-in alias redirect search', async () => {
    await expectAliasReplacement(
      '/sign-in-2?redirect=%2Fsettings',
      '/sign-in',
      '/settings'
    )
  })
})
