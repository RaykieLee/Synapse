import { type QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { Toaster } from '@/components/ui/sonner'
import { NavigationProgress } from '@/components/navigation-progress'
import { LanguageSwitch } from '@/components/language-switch'
import { GeneralError } from '@/features/errors/general-error'
import { NotFoundError } from '@/features/errors/not-found-error'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  component: RootLayout,
  notFoundComponent: NotFoundError,
  errorComponent: GeneralError,
})

function RootLayout() {
  const isLoginPage = useRouterState({
    select: (state) => state.location.pathname === '/sign-in',
  })
  return (
    <>
      <NavigationProgress />
      <div className='fixed right-3 top-3 z-[100]'>
        <LanguageSwitch />
      </div>
      <Outlet />
      <Toaster duration={5000} />
      {import.meta.env.MODE === 'development' && !isLoginPage && (
        <>
          <ReactQueryDevtools buttonPosition='bottom-left' />
          <TanStackRouterDevtools position='bottom-right' />
        </>
      )}
    </>
  )
}
