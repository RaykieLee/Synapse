/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react'
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useAuth, UserButton } from '@clerk/react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { ClerkLogo } from '@/assets/clerk-logo'
import { Button } from '@/components/ui/button'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { LearnMore } from '@/components/learn-more'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { UsersDialogs } from '@/features/users/components/users-dialogs'
import { UsersPrimaryButtons } from '@/features/users/components/users-primary-buttons'
import { UsersProvider } from '@/features/users/components/users-provider'
import { UsersTable } from '@/features/users/components/users-table'
import { users } from '@/features/users/data/users'
import { LocalizedText } from '@/components/localized-text'

export const Route = createFileRoute('/clerk/_authenticated/user-management')({
  component: UserManagement,
})

function UserManagement() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  const [opened, setOpened] = useState(true)
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) {
    return (
      <div className='flex h-svh items-center justify-center'>
        <Loader2 className='size-8 animate-spin' />
      </div>
    )
  }

  if (!isSignedIn) {
    return <Unauthorized />
  }

  return (
    <UsersProvider>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <UserButton />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'><LocalizedText text={"User List"} /></h2>
            <div className='flex gap-1'>
              <p className='text-muted-foreground'>
                <LocalizedText text={"\n                Manage your users and their roles here.\n              "} /></p>
              <LearnMore
                open={opened}
                onOpenChange={setOpened}
                contentProps={{ side: 'right' }}
              >
                <p>
                  <LocalizedText text={"\n                  This is the same as"} />{' '}
                  <Link
                    to='/users'
                    className='text-blue-500 underline decoration-dashed underline-offset-2'
                  >
                    <LocalizedText text={"\n                    '/users'\n                  "} /></Link>
                </p>

                <p className='mt-4'>
                  <LocalizedText text={"\n                  You can sign out or manage/delete your account via the User\n                  Profile menu in the top-right corner of the page.\n                  "} /><ExternalLink className='inline-block size-4' />
                </p>
              </LearnMore>
            </div>
          </div>
          <UsersPrimaryButtons />
        </div>
        <UsersTable data={users} navigate={navigate} search={search} />
      </Main>

      <UsersDialogs />
    </UsersProvider>
  )
}

const COUNTDOWN = 5 // Countdown second

function Unauthorized() {
  const navigate = useNavigate()
  const { history } = useRouter()

  const [opened, setOpened] = useState(true)
  const [cancelled, setCancelled] = useState(false)
  const [countdown, setCountdown] = useState(COUNTDOWN)

  // Set and run the countdown conditionally
  useEffect(() => {
    if (cancelled || opened) return
    const interval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(interval)
  }, [cancelled, opened])

  // Navigate to sign-in page when countdown hits 0
  useEffect(() => {
    if (countdown > 0) return
    navigate({ to: '/clerk/sign-in' })
  }, [countdown, navigate])

  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <h1 className='text-[7rem] leading-tight font-bold'><LocalizedText text={"401"} /></h1>
        <span className='font-medium'><LocalizedText text={"Unauthorized Access"} /></span>
        <p className='text-center text-muted-foreground'>
          <LocalizedText text={"\n          You must be authenticated via Clerk"} />{' '}
          <sup>
            <LearnMore open={opened} onOpenChange={setOpened}>
              <p>
                <LocalizedText text={"\n                This is the same as"} />{' '}
                <Link
                  to='/users'
                  className='text-blue-500 underline decoration-dashed underline-offset-2'
                >
                  <LocalizedText text={"\n                  '/users'\n                "} /></Link>
                <LocalizedText text={"\n                ."} />{' '}
              </p>
              <p><LocalizedText text={"You must first sign in using Clerk to access this route. "} /></p>

              <p className='mt-4'>
                <LocalizedText text={"\n                After signing in, you'll be able to sign out or delete your\n                account via the User Profile dropdown on this page.\n              "} /></p>
            </LearnMore>
          </sup>
          <br />
          <LocalizedText text={"\n          to access this resource.\n        "} /></p>
        <div className='mt-6 flex gap-4'>
          <Button variant='outline' onClick={() => history.go(-1)}>
            <LocalizedText text={"\n            Go Back\n          "} /></Button>
          <Button onClick={() => navigate({ to: '/clerk/sign-in' })}>
            <ClerkLogo className='invert' /> <LocalizedText text={" Sign in\n          "} /></Button>
        </div>
        <div className='mt-4 h-8 text-center'>
          {!cancelled && !opened && (
            <>
              <p>
                {countdown > 0 ? `Redirecting to Sign In page in ${countdown}s` : <LocalizedText text={"Redirecting..."} />}
              </p>
              <Button variant='link' onClick={() => setCancelled(true)}>
                <LocalizedText text={"\n                Cancel Redirect\n              "} /></Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
