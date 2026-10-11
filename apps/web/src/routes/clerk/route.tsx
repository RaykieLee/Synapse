/* eslint-disable react-refresh/only-export-components */
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { ClerkProvider } from '@clerk/react'
import { ExternalLink, Key } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { ConfigDrawer } from '@/components/config-drawer'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { LocalizedText } from '@/components/localized-text'

export const Route = createFileRoute('/clerk')({
  component: RouteComponent,
})

// Import your Publishable Key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

function RouteComponent() {
  if (!PUBLISHABLE_KEY) {
    return <MissingClerkPubKey />
  }

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl='/clerk/sign-in'
      signInUrl='/clerk/sign-in'
      signUpUrl='/clerk/sign-up'
      signInFallbackRedirectUrl='/clerk/user-management'
      signUpFallbackRedirectUrl='/clerk/user-management'
    >
      <Outlet />
    </ClerkProvider>
  )
}

function MissingClerkPubKey() {
  const codeBlock =
    'bg-foreground/10 rounded-sm py-0.5 px-1 text-xs text-foreground font-bold'
  return (
    <AuthenticatedLayout>
      <div className='bg-backgroundh-16 flex justify-between p-4'>
        <SidebarTrigger variant='outline' className='scale-125 sm:scale-100' />
        <div className='space-x-4'>
          <ThemeSwitch />
          <ConfigDrawer />
        </div>
      </div>
      <Main className='flex flex-col items-center justify-start'>
        <div className='max-w-2xl'>
          <Alert>
            <Key className='size-4' />
            <AlertTitle><LocalizedText text={"No Publishable Key Found!"} /></AlertTitle>
            <AlertDescription>
              <p className='text-balance'>
                <LocalizedText text={"\n                You need to generate a publishable key from Clerk and put it\n                inside the "} /><code className={codeBlock}>.env</code> <LocalizedText text={" file.\n              "} /></p>
            </AlertDescription>
          </Alert>

          <h1 className='mt-4 text-2xl font-bold'><LocalizedText text={"Set your Clerk API key"} /></h1>
          <div className='mt-4 flex flex-col gap-y-4 text-foreground/75'>
            <ol className='list-inside list-decimal space-y-1.5'>
              <li>
                <LocalizedText text={"\n                In the"} />{' '}
                <a
                  href='https://go.clerk.com/GttUAaK'
                  target='_blank'
                  className='underline decoration-dashed underline-offset-4 hover:decoration-solid'
                >
                  <LocalizedText text={"\n                  Clerk\n                  "} /><sup>
                    <ExternalLink className='inline-block size-4' />
                  </sup>
                </a>{' '}
                <LocalizedText text={"\n                Dashboard, navigate to the API keys page.\n              "} /></li>
              <li>
                <LocalizedText text={"\n                In the "} /><strong><LocalizedText text={"Quick Copy"} /></strong> <LocalizedText text={" section, copy your Clerk\n                Publishable Key.\n              "} /></li>
              <li>
                <LocalizedText text={"\n                Rename "} /><code className={codeBlock}>.env.example</code> <LocalizedText text={" to"} />{' '}
                <code className={codeBlock}>.env</code>
              </li>
              <li>
                <LocalizedText text={"\n                Paste your key into your "} /><code className={codeBlock}>.env</code>{' '}
                <LocalizedText text={"\n                file.\n              "} /></li>
            </ol>
            <p><LocalizedText text={"The final result should resemble the following:"} /></p>

            <div className='@container space-y-2 rounded-md bg-slate-800 px-3 py-3 text-sm text-slate-200'>
              <span className='ps-1'><LocalizedText text={".env"} /></span>
              <pre className='overflow-auto overscroll-x-contain rounded bg-slate-950 px-2 py-1 text-xs'>
                <code>
                  <span className='before:text-slate-400 md:before:pe-2 md:before:content-["1."]'>
                    VITE_CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
                  </span>
                </code>
              </pre>
            </div>
          </div>

          <Separator className='my-4 w-full' />

          <Alert>
            <AlertTitle><LocalizedText text={"Clerk Integration is Optional"} /></AlertTitle>
            <AlertDescription>
              <p className='text-balance'>
                <LocalizedText text={"\n                The Clerk integration lives entirely inside"} />{' '}
                <code className={codeBlock}>src/routes/clerk</code><LocalizedText text={". If you plan\n                to use Clerk as your auth service, you might want to place"} />{' '}
                <code className={codeBlock}>ClerkProvider</code> <LocalizedText text={" at the root\n                route.\n              "} /></p>
              <p>
                <LocalizedText text={"\n                However, if you don't plan to use Clerk, you can safely remove\n                this directory and related dependency_"} />{' '}
                <code className={codeBlock}>@clerk/react</code><LocalizedText text={".\n              "} /></p>
              <p className='mt-2 text-sm'>
                <LocalizedText text={"\n                This setup is modular by design and won't affect the rest of the\n                application.\n              "} /></p>
            </AlertDescription>
          </Alert>
        </div>
      </Main>
    </AuthenticatedLayout>
  )
}
