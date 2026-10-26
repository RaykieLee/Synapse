import { beforeEach, describe, expect, it, vi } from 'vitest'

async function importAuthStore() {
  const { useAuthStore } = await import('./auth-store')
  return useAuthStore
}

const sampleUser = {
  user_id: '1',
  user_name: 'user',
  nick_name: 'User',
  email: 'user@example.com',
  phonenumber: null,
  sex: null,
  avatar: null,
  status: 'active',
  platform_role: 'user',
}

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('starts without a user and keeps session credentials out of the store', async () => {
    const useAuthStore = await importAuthStore()

    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth).not.toHaveProperty('accessToken')
  })

  it('updates the signed-in user via setUser', async () => {
    const useAuthStore = await importAuthStore()

    useAuthStore.getState().auth.setUser({ ...sampleUser })

    expect(useAuthStore.getState().auth.user).toEqual(sampleUser)
  })

  it('reset clears the in-memory user', async () => {
    const useAuthStore = await importAuthStore()
    useAuthStore.getState().auth.setUser({ ...sampleUser })

    useAuthStore.getState().auth.reset()

    expect(useAuthStore.getState().auth.user).toBeNull()

    vi.resetModules()
    const useAuthStoreAfterReload = await importAuthStore()

    expect(useAuthStoreAfterReload.getState().auth.user).toBeNull()
  })
})
