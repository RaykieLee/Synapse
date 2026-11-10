import { useEffect, useState } from 'react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { api, type AuthUser } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LocalizedText } from '@/components/localized-text'
import {
  clearProfileDraft,
  getProfileDraft,
  getSuspendedProfileDraft,
  saveProfileDraft,
  type ProfileValues,
} from './profile-draft'

const formValues = (user: AuthUser | null): ProfileValues => ({
  nick_name: user?.nick_name ?? '',
  email: user?.email ?? '',
  phonenumber: user?.phonenumber ?? '',
  sex: user?.sex ?? '',
  avatar: user?.avatar ?? '',
})

export function ProfileForm({ onSaved }: { onSaved?: () => void }) {
  const user = useAuthStore((s) => s.auth.user)
  const setUser = useAuthStore((s) => s.auth.setUser)
  const [draft, setDraft] = useState(() => {
    if (user) {
      return getProfileDraft(user.user_id) ?? {
        accountId: user.user_id,
        values: formValues(user),
      }
    }
    return getSuspendedProfileDraft() ?? { accountId: null, values: formValues(null) }
  })
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const canEdit = Boolean(user && draft.accountId === user.user_id)
  const form = user && draft.accountId !== user.user_id ? formValues(user) : draft.values

  useEffect(() => {
    if (user) {
      const savedDraft = getProfileDraft(user.user_id)
      setDraft({
        accountId: user.user_id,
        values: savedDraft?.values ?? formValues(user),
      })
    } else {
      const suspendedDraft = getSuspendedProfileDraft()
      if (suspendedDraft) setDraft(suspendedDraft)
    }
    setErrorMessage(null)
  }, [user?.user_id])

  const update = (key: keyof ProfileValues, value: string) => {
    if (!user || !canEdit) return
    const updated = { ...draft.values, [key]: value }
    saveProfileDraft(user.user_id, updated)
    setDraft({ accountId: user.user_id, values: updated })
  }

  function discardDraft() {
    const accountId = user?.user_id ?? draft.accountId
    if (accountId) clearProfileDraft(accountId)
    setDraft({ accountId: user?.user_id ?? null, values: formValues(user) })
    setErrorMessage(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!user || !canEdit || draft.accountId !== user.user_id) return

    const submittedAccountId = user.user_id
    const submittedValues = { ...draft.values }
    setSaving(true)
    setErrorMessage(null)
    try {
      const updated = await api<AuthUser>('/account/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          nick_name: submittedValues.nick_name || null,
          email: submittedValues.email || null,
          phonenumber: submittedValues.phonenumber || null,
          sex: submittedValues.sex || null,
          avatar: submittedValues.avatar || null,
        }),
      })
      const currentUser = useAuthStore.getState().auth.user
      if (
        !currentUser ||
        currentUser.user_id !== submittedAccountId ||
        updated.user_id !== submittedAccountId
      ) {
        return
      }
      clearProfileDraft(submittedAccountId)
      setDraft({ accountId: submittedAccountId, values: formValues(updated) })
      setUser(updated)
      toast.success('Profile updated for the current account.')
      onSaved?.()
    } catch (error) {
      const currentUser = useAuthStore.getState().auth.user
      if (!currentUser || currentUser.user_id !== submittedAccountId) {
        setErrorMessage(null)
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Could not update the current account profile.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className='space-y-5' aria-busy={saving}>
      {!canEdit ? (
        <p role='alert' className='text-sm text-destructive'>
          <LocalizedText text='The current account is not loaded. Reload the page and try again.' />
        </p>
      ) : null}
      <div className='space-y-2'>
        <Label htmlFor='profile-username'><LocalizedText text='Username' /></Label>
        <Input id='profile-username' value={user?.user_name ?? ''} disabled />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='nick_name'><LocalizedText text='Display name' /></Label>
        <Input id='nick_name' value={form.nick_name} onChange={(e) => update('nick_name', e.target.value)} maxLength={100} disabled={!canEdit || saving} />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='email'><LocalizedText text='Email' /></Label>
        <Input id='email' type='email' value={form.email} onChange={(e) => update('email', e.target.value)} maxLength={254} disabled={!canEdit || saving} />
        <p className='text-sm text-muted-foreground'><LocalizedText text='Email changes update the account field; no email verification flow is available.' /></p>
      </div>
      <div className='space-y-2'>
        <Label htmlFor='phonenumber'><LocalizedText text='Phone' /></Label>
        <Input id='phonenumber' value={form.phonenumber} onChange={(e) => update('phonenumber', e.target.value)} maxLength={32} disabled={!canEdit || saving} />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='sex'><LocalizedText text='Sex' /></Label>
        <LocalizedNativeSelect id='sex' className='h-11 w-full rounded-md border bg-background px-3 text-sm' value={form.sex} onChange={(e) => update('sex', e.target.value)} disabled={!canEdit || saving}>
          <option value=''><LocalizedText text='Unspecified' /></option>
          <option value='0'><LocalizedText text='Unknown' /></option>
          <option value='1'><LocalizedText text='Male' /></option>
          <option value='2'><LocalizedText text='Female' /></option>
        </LocalizedNativeSelect>
      </div>
      <div className='space-y-2'>
        <Label htmlFor='avatar'><LocalizedText text='Avatar URL' /></Label>
        <Input id='avatar' value={form.avatar} onChange={(e) => update('avatar', e.target.value)} disabled={!canEdit || saving} />
        <p className='text-sm text-muted-foreground'><LocalizedText text='Enter a URL only; image upload is not available.' /></p>
      </div>
      {errorMessage ? <p role='alert' className='text-sm text-destructive'>{errorMessage}</p> : null}
      <div className='flex gap-2'>
        <Button type='submit' disabled={!canEdit || saving}>
          <LocalizedText text={saving ? 'Saving…' : 'Save profile'} />
        </Button>
        <Button type='button' variant='outline' onClick={discardDraft} disabled={saving || (!draft.accountId && !user)}>
          <LocalizedText text='Reset' />
        </Button>
      </div>
    </form>
  )
}
