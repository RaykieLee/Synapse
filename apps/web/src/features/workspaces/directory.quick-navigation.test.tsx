import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import {
  useWorkspaceDirectory,
  useWorkspaceSwitch,
} from './directory'

// Identity and successful directory fixtures are simulated; no backend is contacted.

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  queryClient: { removeQueries: vi.fn() },
  pathname: '/w/workspace-1/chat',
  actorId: 'actor-1',
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: ({ select }: { select: (state: any) => unknown }) =>
    select({ location: { pathname: mocks.pathname } }),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: () => mocks.queryClient,
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: any) => unknown) =>
    selector({ auth: { user: { user_id: mocks.actorId } } }),
}))

const tenant = {
  tenant_id: 'tenant-1',
  name: 'Northwind',
  tenant_role: 'member' as const,
}

const workspace = {
  workspace_id: 'workspace-1',
  tenant_id: 'tenant-1',
  slug: 'research-team',
  name: 'Research Room',
  icon: null,
  status: 'active' as const,
  workspace_role: 'member' as const,
  membership_version: 17,
}

function createDirectory() {
  return {
    actorId: 'actor-1',
    tenants: [tenant],
    tenantById: new Map([[tenant.tenant_id, tenant]]),
    workspaces: [workspace],
    tenantQuery: { isSuccess: true, refetch: vi.fn() },
    workspaceQuery: { isSuccess: true, refetch: vi.fn() },
  }
}

let directory = createDirectory() as unknown as ReturnType<
  typeof useWorkspaceDirectory
>
let switchWorkspace: ((workspaceId: string) => Promise<boolean>) | null = null

function SwitchProbe() {
  switchWorkspace = useWorkspaceSwitch(directory)
  return null
}

describe('Quick Navigation directory switch authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mocks.pathname = '/w/workspace-1/chat'
    mocks.actorId = 'actor-1'
    directory = createDirectory() as unknown as ReturnType<
      typeof useWorkspaceDirectory
    >
    switchWorkspace = null
  })

  it('rejects targets absent from the successful current-actor directory', async () => {
    await render(<SwitchProbe />)

    await expect(switchWorkspace?.('hidden-workspace')).resolves.toBe(false)
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(
      window.localStorage.getItem('synapse:recent-workspace:actor-1')
    ).toBeNull()
  })

  it('rejects a directory whose actor does not match the current account', async () => {
    directory.actorId = 'actor-1'
    mocks.actorId = 'actor-2'
    await render(<SwitchProbe />)

    await expect(switchWorkspace?.('workspace-1')).resolves.toBe(false)
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('uses the validated directory switch flow for an authorized Workspace', async () => {
    await render(<SwitchProbe />)

    await expect(switchWorkspace?.('workspace-1')).resolves.toBe(true)
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/w/workspace-1' })
    expect(
      JSON.parse(
        window.localStorage.getItem('synapse:recent-workspace:actor-1') ?? 'null'
      )
    ).toMatchObject({ workspace_id: 'workspace-1' })
  })
})
