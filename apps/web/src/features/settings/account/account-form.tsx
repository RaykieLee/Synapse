import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function AccountForm() {
  const reset = useAuthStore((s) => s.auth.reset)
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (next.length < 12) { toast.error('New password must be at least 12 characters.'); return }
    setSaving(true)
    try {
      await api<void>('/account/password', { method: 'POST', body: JSON.stringify({ current_password: current, new_password: next }) })
      reset(); toast.success('Password changed. Please sign in again.')
      await navigate({ to: '/sign-in', replace: true })
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not change password.') }
    finally { setSaving(false) }
  }
  return <form onSubmit={submit} className='space-y-5'>
    <div className='space-y-2'><Label htmlFor='current-password'>Current password</Label><Input id='current-password' type='password' autoComplete='current-password' required value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
    <div className='space-y-2'><Label htmlFor='new-password'>New password</Label><Input id='new-password' type='password' autoComplete='new-password' minLength={12} required value={next} onChange={(e) => setNext(e.target.value)} /><p className='text-sm text-muted-foreground'>At least 12 characters. You will need to sign in again after changing it.</p></div>
    <Button type='submit' disabled={saving}>{saving ? 'Updating…' : 'Change password'}</Button>
  </form>
}
