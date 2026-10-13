import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { setLocale } from '@/lib/i18n'
import type { CreatedTenantInvitation } from '../types'
import { InvitationPanel } from './invitation-panel'

const CREATED_INVITATION: CreatedTenantInvitation = {
  invitation_id: 'invitation-1',
  tenant_id: 'tenant-1',
  email: 'member@example.com',
  target_user_id: null,
  tenant_role: 'member',
  status: 'pending',
  expired: false,
  expires_at: '2026-10-20T00:00:00Z',
  invited_by: 'user-1',
  created_at: '2026-10-13T00:00:00Z',
  token: 'secret-token',
  invite_link: '/invite/secret-token',
}

describe('InvitationPanel', () => {
  beforeEach(() => setLocale('zh-CN'))
  afterEach(() => setLocale('zh-CN'))

  it('opens a created invitation link in a dialog', async () => {
    const { getByRole } = await render(
      <InvitationPanel
        pending={false}
        created={CREATED_INVITATION}
        invitations={[]}
        loading={false}
        canInviteAdmin={false}
        onCreate={vi.fn()}
        onRevoke={vi.fn()}
      />
    )

    await expect
      .element(getByRole('dialog', { name: '邀请链接已创建' }))
      .toBeInTheDocument()

    await userEvent.click(
      getByRole('dialog', { name: '邀请链接已创建' }).getByRole('button', {
        name: /Close|关闭/i,
      })
    )

    await expect
      .element(getByRole('dialog', { name: '邀请链接已创建' }))
      .not.toBeInTheDocument()
  })
})
