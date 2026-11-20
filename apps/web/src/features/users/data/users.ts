export type User = {
  id: string
  firstName: string
  lastName: string
  username: string
  email: string
  phoneNumber: string
  status: 'active' | 'inactive' | 'invited' | 'suspended'
  role: string
  createdAt: string
  updatedAt: string
}

export const users: User[] = [
  {
    id: 'user-001',
    firstName: 'Alpha',
    lastName: 'Lin',
    username: 'alpha.lin',
    email: 'alpha.lin@example.com',
    phoneNumber: '+10000000001',
    status: 'active',
    role: 'platform_admin',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
  {
    id: 'user-002',
    firstName: 'Beta',
    lastName: 'Chen',
    username: 'beta.chen',
    email: 'beta.chen@example.com',
    phoneNumber: '+10000000002',
    status: 'invited',
    role: 'tenant_owner',
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-04T00:00:00Z',
  },
  {
    id: 'user-003',
    firstName: 'Gamma',
    lastName: 'Wu',
    username: 'gamma.wu',
    email: 'gamma.wu@example.com',
    phoneNumber: '+10000000003',
    status: 'inactive',
    role: 'tenant_admin',
    createdAt: '2026-01-05T00:00:00Z',
    updatedAt: '2026-01-06T00:00:00Z',
  },
  {
    id: 'user-004',
    firstName: 'Delta',
    lastName: 'Huang',
    username: 'delta.huang',
    email: 'delta.huang@example.com',
    phoneNumber: '+10000000004',
    status: 'suspended',
    role: 'tenant_member',
    createdAt: '2026-01-07T00:00:00Z',
    updatedAt: '2026-01-08T00:00:00Z',
  },
  {
    id: 'user-005',
    firstName: 'Epsilon',
    lastName: 'Su',
    username: 'epsilon.su',
    email: 'epsilon.su@example.com',
    phoneNumber: '+10000000005',
    status: 'active',
    role: 'workspace_member',
    createdAt: '2026-01-09T00:00:00Z',
    updatedAt: '2026-01-10T00:00:00Z',
  },
]
