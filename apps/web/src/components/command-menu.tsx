import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { ArrowRight, ChevronRight, Laptop, Moon, Sun, X } from 'lucide-react'
import { getWorkspace } from '@/api/workspaces'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useSearch } from '@/context/search-provider'
import { useTheme } from '@/context/theme-provider'
import {
  readRecentWorkspace,
  useWorkspaceDirectory,
  useWorkspaceSwitch,
} from '@/features/workspaces/directory'
import {
  buildTenantNavigationGroup,
  buildWorkspaceNavigationGroup,
  selectAuthorizedNavigationCandidates,
  selectPlatformNavigationGroup,
  sidebarData,
  type AuthorizedNavigationCandidate,
  type NavigationMenuResponse,
  type VerifiedNavigationScope,
} from '@/components/layout/data/sidebar-data'
import type { NavGroup, NavItem } from '@/components/layout/types'
import { setLocale, translate, useLocale } from '@/lib/i18n'
import { commandSearchMessage } from './command-search-messages'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export type QuickNavigationEntry = {
  id: string
  kind: 'route' | 'workspace-switch' | 'command'
  title: string
  aliases: string[]
  breadcrumbs: string[]
  href?: string
  workspaceId?: string
  external?: boolean
  current?: boolean
  run?: () => void
}

export function filterQuickNavigationEntries(
  entries: QuickNavigationEntry[],
  query: string
) {
  const search = query.trim()
  if (!search) return entries
  const lowerSearch = search.toLocaleLowerCase()
  return entries.filter((entry) =>
    [entry.title, ...entry.aliases, ...entry.breadcrumbs].some(
      (label) =>
        label.includes(search) ||
        label.toLocaleLowerCase().includes(lowerSearch)
    )
  )
}

function navigationAliases(label: string) {
  return Array.from(
    new Set([label, translate(label, 'zh-CN'), translate(label, 'en')])
  )
}

function isInternalRoute(href: string) {
  return (
    href.startsWith('/') &&
    !href.startsWith('//') &&
    href.indexOf(String.fromCharCode(92)) === -1
  )
}

function safeExternalRoute(href: string) {
  try {
    const url = new URL(href, window.location.origin)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

function flattenNavigationGroups(
  groups: NavGroup[],
  locale: ReturnType<typeof useLocale>,
  pathname: string
) {
  const entries: QuickNavigationEntry[] = []
  for (const group of groups) {
    const section = translate(group.title, locale)
    for (const item of group.items) {
      const parent = 'items' in item && item.items ? item : null
      const links = parent ? parent.items : [item as NavItem & { url: string }]
      for (const link of links) {
        if (!('url' in link) || !link.url) continue
        const href = String(link.url)
        if (!isInternalRoute(href)) continue
        const title = translate(link.title, locale)
        const parentTitle = parent ? translate(parent.title, locale) : null
        const breadcrumbs = parentTitle ? [section, parentTitle] : [section]
        entries.push({
          id: 'route:' + href,
          kind: 'route',
          title,
          aliases: navigationAliases(link.title),
          breadcrumbs,
          href,
          current: pathname === href || pathname.startsWith(href + '/'),
        })
      }
    }
  }
  return entries
}

function dynamicNavigationEntries(
  candidates: AuthorizedNavigationCandidate[],
  workspaceGroup: NavGroup,
  locale: ReturnType<typeof useLocale>,
  pathname: string
) {
  const existingUrls = new Set<string>()
  for (const item of workspaceGroup.items) {
    if ('url' in item && item.url) existingUrls.add(String(item.url))
    if ('items' in item && item.items) {
      for (const child of item.items) existingUrls.add(String(child.url))
    }
  }
  const seenUrls = new Set(existingUrls)
  return candidates.flatMap((candidate) => {
    if (seenUrls.has(candidate.url) || !candidate.title) return []
    const externalHref = candidate.external
      ? safeExternalRoute(candidate.url)
      : null
    if (candidate.external ? !externalHref : !isInternalRoute(candidate.url))
      return []
    seenUrls.add(candidate.url)
    return [
      {
        id: 'dynamic:' + candidate.id,
        kind: 'route' as const,
        title: candidate.title,
        aliases: [candidate.title],
        breadcrumbs: [translate(workspaceGroup.title, locale)],
        href: externalHref ?? candidate.url,
        external: candidate.external,
        current:
          !candidate.external &&
          (pathname === candidate.url || pathname.startsWith(candidate.url + '/')),
      },
    ]
  })
}

function activeWorkspaceId(pathname: string) {
  return pathname.match(/^\/w\/([^/]+)/)?.[1]
}

function activeTenantId(pathname: string) {
  return pathname.match(/^\/tenants\/([^/]+)/)?.[1]
}

function localizedScope(scope: VerifiedNavigationScope | null, tenantName: string | undefined, workspaceName: string | undefined, locale: ReturnType<typeof useLocale>) {
  if (scope && workspaceName && tenantName) {
    return commandSearchMessage(locale, 'workspace-scope', {
      workspace: workspaceName,
      tenant: tenantName,
    })
  }
  if (tenantName) {
    return commandSearchMessage(locale, 'tenant-scope', { tenant: tenantName })
  }
  return commandSearchMessage(locale, 'global-scope')
}

export function CommandMenu() {
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const authUser = useAuthStore((state) => state.auth.user)
  const directory = useWorkspaceDirectory(true)
  const switchWorkspace = useWorkspaceSwitch(directory)
  const locale = useLocale()
  const { setTheme } = useTheme()
  const { open, setOpen, triggerRef } = useSearch()
  const workspaceId = activeWorkspaceId(pathname)
  const routeTenantId = activeTenantId(pathname)
  const directoryActorConfirmed = Boolean(
    authUser?.user_id && directory.actorId === authUser.user_id
  )
  const workspace = workspaceId && directoryActorConfirmed
    ? directory.workspaces.find((item) => item.workspace_id === workspaceId)
    : undefined

  const detail = useQuery({
    queryKey: [
      'synapse',
      directory.actorId,
      workspace?.tenant_id ?? 'unresolved',
      workspaceId ?? 'none',
      'workspace-detail',
      workspace?.membership_version ?? 0,
    ],
    queryFn: () => getWorkspace(workspaceId!),
    enabled: Boolean(
      authUser?.user_id &&
        directoryActorConfirmed &&
        workspaceId &&
        workspace &&
        directory.tenantQuery.isSuccess &&
        directory.workspaceQuery.isSuccess
    ),
    initialData: workspace,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const detailVersion = detail.data?.membership_version
  const workspaceContextReady = Boolean(
    authUser?.user_id &&
      directoryActorConfirmed &&
      workspace &&
      directory.tenantQuery.isSuccess &&
      directory.workspaceQuery.isSuccess &&
      detail.data &&
      detail.isFetched &&
      !detail.isFetching &&
      !detail.isError &&
      detail.data.workspace_id === workspaceId &&
      detail.data.tenant_id === workspace.tenant_id &&
      Number.isInteger(detailVersion) &&
      detailVersion! >= 0 &&
      directory.tenantById.has(detail.data.tenant_id)
  )
  const tenant =
    routeTenantId && directoryActorConfirmed && directory.tenantQuery.isSuccess
      ? directory.tenantById.get(routeTenantId)
      : workspaceContextReady && detail.data
        ? directory.tenantById.get(detail.data.tenant_id)
        : undefined
  const tenantContextReady = routeTenantId
    ? Boolean(directoryActorConfirmed && directory.tenantQuery.isSuccess && tenant)
    : workspaceId
      ? workspaceContextReady
      : Boolean(authUser?.user_id)
  const contextReady = workspaceId
    ? workspaceContextReady
    : routeTenantId
      ? tenantContextReady
      : Boolean(authUser?.user_id)
  const contextScope = React.useMemo<VerifiedNavigationScope | null>(() => {
    if (
      !workspaceContextReady ||
      !authUser?.user_id ||
      !detail.data ||
      !workspaceId ||
      !Number.isInteger(detailVersion) ||
      detailVersion! < 0
    )
      return null
    return {
      verified: true,
      actorId: authUser.user_id,
      tenantId: detail.data.tenant_id,
      workspaceId: detail.data.workspace_id,
      membershipVersion: detailVersion!,
    }
  }, [authUser?.user_id, detail.data, detailVersion, workspaceContextReady, workspaceId])

  const navigationKey = contextScope
    ? [
        'synapse',
        contextScope.actorId,
        contextScope.tenantId,
        'tenant-navigation',
        contextScope.workspaceId,
        contextScope.membershipVersion,
      ]
    : [
        'synapse',
        authUser?.user_id ?? 'anonymous',
        'unresolved',
        'tenant-navigation',
        workspaceId ?? 'none',
        0,
      ]
  const navigation = useQuery({
    queryKey: navigationKey,
    queryFn: () =>
      api<NavigationMenuResponse>(
        '/tenants/' + contextScope!.tenantId + '/menus/visible-tree'
      ),
    enabled: Boolean(contextScope),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })
  const authorizedNavigation = selectAuthorizedNavigationCandidates(
    navigation.data,
    contextScope
  )

  const [searchState, setSearchState] = React.useState({ scopeKey: '', value: '' })
  const [activeEntryId, setActiveEntryId] = React.useState('')
  const [switchTargetUnavailable, setSwitchTargetUnavailable] = React.useState(false)
  const closeReason = React.useRef<'dismiss' | 'destination'>('dismiss')
  const stateScopeKey = JSON.stringify([
    authUser?.user_id ?? 'anonymous',
    pathname,
    contextScope?.tenantId ?? routeTenantId ?? 'unresolved',
    contextScope?.workspaceId ?? workspaceId ?? 'none',
    contextScope?.membershipVersion ?? detailVersion ?? 0,
  ])
  const query = searchState.scopeKey === stateScopeKey ? searchState.value : ''
  const setQuery = (value: string) => setSearchState({ scopeKey: stateScopeKey, value })
  React.useEffect(() => {
    if (searchState.scopeKey !== stateScopeKey) {
      setSearchState({ scopeKey: stateScopeKey, value: '' })
      setActiveEntryId('')
      setSwitchTargetUnavailable(false)
    }
  }, [searchState.scopeKey, stateScopeKey])

  const navGroups: NavGroup[] = []
  const platformGroup = selectPlatformNavigationGroup(
    authUser?.platform_role === 'platform_admin'
  )
  if (platformGroup) {
    navGroups.push(platformGroup)
  } else if (authUser) {
    navGroups.push({
      title: '租户',
      items: [{ title: '我的租户', url: '/tenants' }],
    })
  }
  if (tenantContextReady && tenant?.tenant_role) {
    const tenantGroup = buildTenantNavigationGroup(
      tenant.tenant_id,
      tenant.tenant_role
    )
    if (tenantGroup) navGroups.push(tenantGroup)
  }
  const workspaceGroup =
    workspaceContextReady && workspaceId && detail.data
      ? buildWorkspaceNavigationGroup(workspaceId, detail.data.workspace_role)
      : null
  if (workspaceGroup) navGroups.push(workspaceGroup)
  const personalGroup = sidebarData.navGroups.find(
    (group) => group.title === '个人'
  )
  if (personalGroup) navGroups.push(personalGroup)

  const navigationEntries = flattenNavigationGroups(navGroups, locale, pathname)
  if (
    workspaceGroup &&
    contextScope &&
    navigation.isSuccess &&
    !navigation.isFetching &&
    authorizedNavigation
  ) {
    navigationEntries.push(
      ...dynamicNavigationEntries(
        authorizedNavigation,
        workspaceGroup,
        locale,
        pathname
      )
    )
  }

  const directoryComplete = Boolean(
    authUser &&
      directoryActorConfirmed &&
      directory.tenantQuery.isSuccess &&
      directory.workspaceQuery.isSuccess
  )
  const directoryError = Boolean(
    directory.tenantQuery.isError || directory.workspaceQuery.isError
  )
  const directoryLoading = Boolean(
    authUser &&
      !directoryError &&
      (!directory.tenantQuery.isSuccess || !directory.workspaceQuery.isSuccess)
  )
  const confirmedDirectoryWorkspaces = directoryComplete
    ? directory.workspaces.filter((item) => directory.tenantById.has(item.tenant_id))
    : []
  const recentWorkspace =
    authUser && directoryComplete ? readRecentWorkspace(authUser.user_id) : null
  const recentWorkspaceId = confirmedDirectoryWorkspaces.some(
    (item) => item.workspace_id === recentWorkspace?.workspace_id
  )
    ? recentWorkspace?.workspace_id
    : null
  const workspaceEntries = directoryComplete
    ? confirmedDirectoryWorkspaces
        .sort(
          (first, second) =>
            Number(second.workspace_id === recentWorkspaceId) -
            Number(first.workspace_id === recentWorkspaceId)
        )
        .map((item) => {
          const tenantName = directory.tenantById.get(item.tenant_id)!.name
          return {
            id: 'workspace:' + item.workspace_id,
            kind: 'workspace-switch' as const,
            title: item.name,
            aliases: [item.slug],
            breadcrumbs: [tenantName],
            workspaceId: item.workspace_id,
            current: item.workspace_id === workspaceId,
          }
        })
    : []

  const text = (key: Parameters<typeof commandSearchMessage>[1]) =>
    commandSearchMessage(locale, key)
  const commandEntries: QuickNavigationEntry[] = [
    {
      id: 'command:theme-light',
      kind: 'command',
      title: text('light'),
      aliases: navigationAliases('Light'),
      breadcrumbs: [text('commands'), text('theme')],
      run: () => setTheme('light'),
    },
    {
      id: 'command:theme-dark',
      kind: 'command',
      title: text('dark'),
      aliases: navigationAliases('Dark'),
      breadcrumbs: [text('commands'), text('theme')],
      run: () => setTheme('dark'),
    },
    {
      id: 'command:theme-system',
      kind: 'command',
      title: text('system'),
      aliases: navigationAliases('System'),
      breadcrumbs: [text('commands'), text('theme')],
      run: () => setTheme('system'),
    },
    {
      id: 'command:language-zh',
      kind: 'command',
      title: text('switch-to-chinese'),
      aliases: navigationAliases('Switch to Chinese').concat(['中文']),
      breadcrumbs: [text('commands'), text('language')],
      run: () => setLocale('zh-CN'),
    },
    {
      id: 'command:language-en',
      kind: 'command',
      title: text('switch-to-english'),
      aliases: navigationAliases('Switch to English').concat(['English']),
      breadcrumbs: [text('commands'), text('language')],
      run: () => setLocale('en'),
    },
  ]
  const navigationResults = filterQuickNavigationEntries(
    navigationEntries,
    query
  )
  const switchResults = filterQuickNavigationEntries(workspaceEntries, query)
  const commandResults = filterQuickNavigationEntries(commandEntries, query)
  const allVisibleEntries = [...navigationResults, ...switchResults, ...commandResults]

  const contextError = Boolean(
    (workspaceId &&
      (directory.tenantQuery.isError || directory.workspaceQuery.isError || detail.isError)) ||
      (routeTenantId && directory.tenantQuery.isError)
  )
  const routeWorkspaceUnavailable = Boolean(
    workspaceId &&
      directoryActorConfirmed &&
      directory.tenantQuery.isSuccess &&
      directory.workspaceQuery.isSuccess &&
      !workspace
  )
  const contextUnresolved = Boolean(
    !authUser ||
      (workspaceId && !contextReady && !contextError && !routeWorkspaceUnavailable) ||
      (routeTenantId && !tenantContextReady && !contextError)
  )
  let contextMessage: string | null = null
  let contextRetry: (() => void) | null = null
  if (contextError) {
    contextMessage = text('context-unavailable')
    contextRetry = () => {
      if (directory.tenantQuery.isError || directory.workspaceQuery.isError) {
        void Promise.all([
          directory.tenantQuery.refetch(),
          directory.workspaceQuery.refetch(),
        ])
      } else {
        void detail.refetch()
      }
    }
  } else if (contextUnresolved) {
    contextMessage = workspaceId
      ? text('verify-workspace')
      : routeTenantId
        ? text('verify-tenant')
        : text('verify-account')
  } else if (routeWorkspaceUnavailable) {
    contextMessage = text('workspace-unavailable')
    contextRetry = () => {
      void Promise.all([
        directory.tenantQuery.refetch(),
        directory.workspaceQuery.refetch(),
      ])
    }
  } else if (routeTenantId && directory.tenantQuery.isSuccess && !tenant) {
    contextMessage = text('tenant-unavailable')
  }

  const notices: Array<{
    message: string
    error?: boolean
    retry?: () => void
  }> = []
  if (contextMessage) {
    notices.push({
      message: contextMessage,
      error: contextError || contextMessage.includes('unavailable'),
      retry: contextRetry ?? undefined,
    })
  }
  if (directoryLoading && !contextUnresolved) {
    notices.push({ message: text('loading-directory') })
  }
  if (directoryError && !workspaceId && !routeTenantId) {
    notices.push({
      message: text('directory-error'),
      error: true,
      retry: () => {
        void Promise.all([
          directory.tenantQuery.refetch(),
          directory.workspaceQuery.refetch(),
        ])
      },
    })
  }
  const navigationLoading = Boolean(
    workspaceContextReady &&
      !navigation.isError &&
      (navigation.isLoading || navigation.isFetching || !navigation.isSuccess)
  )
  if (navigationLoading) notices.push({ message: text('loading-navigation') })
  if (workspaceContextReady && navigation.isError) {
    notices.push({
      message: text('navigation-error'),
      error: true,
      retry: () => void navigation.refetch(),
    })
  }
  if (
    workspaceContextReady &&
    navigation.isSuccess &&
    !navigation.isFetching &&
    authorizedNavigation === null
  ) {
    notices.push({
      message: text('scope-mismatch'),
      error: true,
      retry: () => void navigation.refetch(),
    })
  }
  const navigationEmpty = Boolean(
    workspaceContextReady &&
      navigation.isSuccess &&
      !navigation.isFetching &&
      authorizedNavigation?.length === 0
  )
  if (navigationEmpty) notices.push({ message: text('empty-navigation') })
  const directoryEmpty = directoryComplete && workspaceEntries.length === 0
  if (directoryEmpty) notices.push({ message: text('empty-workspaces') })

  const navigationSourceComplete = Boolean(
    !workspaceId ||
      (workspaceContextReady &&
        navigation.isSuccess &&
        !navigation.isFetching &&
        authorizedNavigation !== null)
  )
  const searchSourcesComplete = Boolean(
    authUser && contextReady && directoryComplete && navigationSourceComplete
  )
  const noResults = Boolean(
    query.trim() &&
      searchSourcesComplete &&
      allVisibleEntries.length === 0
  )
  const noSearchResults = noResults ? text('no-results') : null

  const closeAndRun = (run: () => void) => {
    closeReason.current = 'dismiss'
    setOpen(false)
    run()
  }
  const activateEntry = (entry: QuickNavigationEntry) => {
    if (entry.kind === 'command') {
      closeAndRun(entry.run ?? (() => undefined))
      return
    }
    if (entry.kind === 'workspace-switch' && entry.workspaceId) {
      void switchWorkspace(entry.workspaceId).then((switched) => {
        if (!switched) {
          setSwitchTargetUnavailable(true)
          return
        }
        closeReason.current = 'destination'
        setOpen(false)
      })
      return
    }
    if (!entry.href) return
    closeReason.current = 'destination'
    setOpen(false)
    if (entry.external) {
      const safeHref = safeExternalRoute(entry.href)
      if (safeHref) window.open(safeHref, '_blank', 'noopener,noreferrer')
    } else if (isInternalRoute(entry.href)) {
      void navigate({ to: entry.href as never })
    }
  }

  const scopeLabel = contextScope
    ? localizedScope(contextScope, tenant?.name, workspace?.name, locale)
    : routeTenantId && tenantContextReady && tenant
      ? localizedScope(null, tenant.name, undefined, locale)
      : workspaceId && !workspaceContextReady
        ? null
        : text('global-scope')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-quick-navigation='true'
        className='w-[min(36rem,calc(100vw-1rem))] max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden p-0 sm:max-w-xl'
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (closeReason.current !== 'destination') triggerRef.current?.focus()
          closeReason.current = 'dismiss'
        }}
      >
        <DialogHeader className='sr-only'>
          <DialogTitle>{text('quick-navigation')}</DialogTitle>
          <DialogDescription>{text('search-description')}</DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          value={activeEntryId}
          onValueChange={setActiveEntryId}
          className='max-h-[calc(100dvh-1rem)]'
        >
          <div className='relative'>
            <CommandInput
              aria-label={text('search-placeholder')}
              placeholder={text('search-placeholder')}
              value={query}
              onValueChange={setQuery}
              onKeyDown={(event) => {
                if (
                  (event.key === 'Home' || event.key === 'End') &&
                  !event.nativeEvent.isComposing &&
                  allVisibleEntries.length
                ) {
                  event.preventDefault()
                  setActiveEntryId(
                    event.key === 'Home'
                      ? allVisibleEntries[0].id
                      : allVisibleEntries[allVisibleEntries.length - 1].id
                  )
                }
              }}
              className='pe-12'
            />
            <DialogClose asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='absolute inset-e-2 top-1/2 size-8 -translate-y-1/2'
                aria-label={locale === 'en' ? 'Close quick navigation' : '关闭快速导航'}
              >
                <X aria-hidden='true' className='size-4' />
              </Button>
            </DialogClose>
          </div>
          <div className='border-b px-4 py-2'>
            {scopeLabel ? (
              <p className='text-xs font-medium text-foreground'>{scopeLabel}</p>
            ) : null}
            <p className='text-xs text-muted-foreground'>
              {text('search-description')}
            </p>
          </div>
          {notices.map((notice, index) => (
            <div
              key={notice.message + ':' + index}
              role={notice.error ? 'alert' : 'status'}
              aria-live={notice.error ? 'assertive' : 'polite'}
              className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground'
            >
              <span>{notice.message}</span>
              {notice.retry ? (
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={notice.retry}
                >
                  {text('retry')}
                </Button>
              ) : null}
            </div>
          ))}
          {switchTargetUnavailable ? (
            <div role='alert' className='border-b px-4 py-2 text-xs text-destructive'>
              {text('switch-target-unavailable')}
              <Button
                type='button'
                size='sm'
                variant='outline'
                className='ms-2'
                onClick={() => {
                  void Promise.all([
                    directory.tenantQuery.refetch(),
                    directory.workspaceQuery.refetch(),
                  ])
                }}
              >
                {text('retry')}
              </Button>
            </div>
          ) : null}
          {noSearchResults ? (
            <div
              role='status'
              aria-live='polite'
              className='flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-muted-foreground'
            >
              <span>{noSearchResults}</span>
              <Button type='button' size='sm' variant='ghost' onClick={() => setQuery('')}>
                {text('clear-search')}
              </Button>
            </div>
          ) : null}
          <CommandList className='max-h-[min(65dvh,28rem)] overflow-y-auto px-1'>
            {navigationResults.length ? (
              <CommandGroup heading={text('navigation')}>
                {navigationResults.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={entry.id}
                    aria-label={
                      entry.title + ', ' + entry.breadcrumbs.join(' / ') +
                      (entry.external ? ', ' + text('open-external') : '') +
                      (entry.current ? ', ' + text('current') : '')
                    }
                    aria-current={entry.current ? 'page' : undefined}
                    onSelect={() => activateEntry(entry)}
                    className='items-start py-3'
                  >
                    <ArrowRight aria-hidden='true' className='mt-0.5 size-4 shrink-0' />
                    <span className='min-w-0 flex-1'>
                      <span className='block break-words'>{entry.title}</span>
                      <span className='block break-words text-xs text-muted-foreground'>
                        {entry.breadcrumbs.join(' / ')}
                        {entry.external ? ' · ' + text('open-external') : ''}
                      </span>
                    </span>
                    {entry.current ? (
                      <span className='shrink-0 text-xs text-muted-foreground'>
                        {text('current')}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {switchResults.length ? (
              <CommandGroup heading={text('workspace-switch')}>
                {switchResults.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={entry.id}
                    aria-label={entry.title + ', ' + entry.breadcrumbs.join(' / ')}
                    aria-current={entry.current ? 'page' : undefined}
                    onSelect={() => activateEntry(entry)}
                    className='items-start py-3'
                  >
                    <ChevronRight aria-hidden='true' className='mt-0.5 size-4 shrink-0' />
                    <span className='min-w-0 flex-1'>
                      <span className='block break-words'>{entry.title}</span>
                      <span className='block break-words text-xs text-muted-foreground'>
                        {entry.breadcrumbs.join(' / ')}
                      </span>
                    </span>
                    {entry.current ? (
                      <span className='shrink-0 text-xs text-muted-foreground'>
                        {text('current')}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {commandResults.length ? (
              <>
                {navigationResults.length || switchResults.length ? (
                  <CommandSeparator />
                ) : null}
                <CommandGroup heading={text('commands')}>
                  <div className='px-2 pb-1 text-xs font-medium text-muted-foreground'>
                    {text('theme')}
                  </div>
                  {commandResults
                    .filter((entry) => entry.id.startsWith('command:theme-'))
                    .map((entry) => (
                      <CommandItem key={entry.id} value={entry.id} onSelect={() => activateEntry(entry)}>
                        {entry.id === 'command:theme-light' ? <Sun aria-hidden='true' /> : null}
                        {entry.id === 'command:theme-dark' ? <Moon aria-hidden='true' /> : null}
                        {entry.id === 'command:theme-system' ? <Laptop aria-hidden='true' /> : null}
                        <span>{entry.title}</span>
                      </CommandItem>
                    ))}
                  <div className='px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground'>
                    {text('language')}
                  </div>
                  {commandResults
                    .filter((entry) => entry.id.startsWith('command:language-'))
                    .map((entry) => (
                      <CommandItem key={entry.id} value={entry.id} onSelect={() => activateEntry(entry)}>
                        <span>{entry.title}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
