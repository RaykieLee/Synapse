import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LocalizedText } from '@/components/localized-text'

export function AccountForm() {
  const reset = useAuthStore((s) => s.auth.reset)
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (next.length < 12) {
      setErrorMessage('New password must be at least 12 characters.')
      return
    }
    setSaving(true)
    setErrorMessage(null)
    try {
      await api<void>('/account/password', {
        method: 'POST',
        body: JSON.stringify({ current_password: current, new_password: next }),
      })
      reset()
      toast.success('Password changed. This session has ended; sign in again with the new password.')
      await navigate({ to: '/sign-in', replace: true })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not change the password.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className='space-y-5' aria-busy={saving}>
      <div className='space-y-2'>
        <Label htmlFor='current-password'><LocalizedText text='Current password' /></Label>
        <Input id='current-password' type='password' autoComplete='current-password' required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='new-password'><LocalizedText text='New password' /></Label>
        <Input id='new-password' type='password' autoComplete='new-password' minLength={12} required value={next} onChange={(e) => setNext(e.target.value)} />
        <p className='text-sm text-muted-foreground'><LocalizedText text='At least 12 characters. The current session ends after a successful change.' /></p>
      </div>
      {errorMessage ? <p role='alert' className='text-sm text-destructive'>{errorMessage}</p> : null}
      <Button type='submit' disabled={saving}>
        <LocalizedText text={saving ? 'Updating…' : 'Change password'} />
      </Button>
    </form>
  )
}
