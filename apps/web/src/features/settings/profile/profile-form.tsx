import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { api, type AuthUser } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ProfileForm() {
  const user = useAuthStore((s) => s.auth.user)
  const setUser = useAuthStore((s) => s.auth.setUser)
  const [form, setForm] = useState({ nick_name: '', email: '', phonenumber: '', sex: '', avatar: '' })
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (user) setForm({ nick_name: user.nick_name ?? '', email: user.email ?? '', phonenumber: user.phonenumber ?? '', sex: user.sex ?? '', avatar: user.avatar ?? '' })
  }, [user])
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true)
    try {
      const updated = await api<AuthUser>('/account/profile', { method: 'PATCH', body: JSON.stringify({ nick_name: form.nick_name || null, email: form.email || null, phonenumber: form.phonenumber || null, sex: form.sex || null, avatar: form.avatar || null }) })
      setUser(updated); toast.success('Profile updated.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update profile.') }
    finally { setSaving(false) }
  }
  return <form onSubmit={submit} className='space-y-5'>
    <div className='space-y-2'><Label>Username</Label><Input value={user?.user_name ?? ''} disabled /></div>
    <div className='space-y-2'><Label htmlFor='nick_name'>Display name</Label><Input id='nick_name' value={form.nick_name} onChange={(e) => update('nick_name', e.target.value)} maxLength={100} /></div>
    <div className='space-y-2'><Label htmlFor='email'>Email</Label><Input id='email' type='email' value={form.email} onChange={(e) => update('email', e.target.value)} maxLength={254} /></div>
    <div className='space-y-2'><Label htmlFor='phonenumber'>Phone</Label><Input id='phonenumber' value={form.phonenumber} onChange={(e) => update('phonenumber', e.target.value)} maxLength={32} /></div>
    <div className='space-y-2'><Label htmlFor='sex'>Sex</Label><select id='sex' className='h-9 w-full rounded-md border bg-background px-3 text-sm' value={form.sex} onChange={(e) => update('sex', e.target.value)}><option value=''>Unspecified</option><option value='0'>Unknown</option><option value='1'>Male</option><option value='2'>Female</option></select></div>
    <div className='space-y-2'><Label htmlFor='avatar'>Avatar URL</Label><Input id='avatar' value={form.avatar} onChange={(e) => update('avatar', e.target.value)} /></div>
    <Button type='submit' disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</Button>
  </form>
}
