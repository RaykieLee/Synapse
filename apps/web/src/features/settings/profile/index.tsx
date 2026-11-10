import { useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { ContentSection } from '../components/content-section'
import { ProfileForm } from './profile-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LocalizedText } from '@/components/localized-text'

export function SettingsProfile() {
  const [open, setOpen] = useState(false)
  const user = useAuthStore((s) => s.auth.user)
  const valueOrUnset = (value: string | null | undefined) => value || <LocalizedText text='Not set' />
  const sexLabel = user?.sex === '1' ? 'Male' : user?.sex === '2' ? 'Female' : user?.sex === '0' ? 'Unknown' : null
  return (
    <ContentSection
      title='Profile'
      desc='View and update profile fields for the current global account.'
    >
      <div className='space-y-4'>
        <div className='flex flex-col items-start gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <p className='font-medium'><LocalizedText text='个人资料' /></p>
            <p className='text-sm text-muted-foreground'><LocalizedText text='当前账号资料来自 /auth/me；空字段显示为未设置。' /></p>
          </div>
          <Button className='w-full sm:w-auto' variant='outline' disabled={!user} onClick={() => setOpen(true)}>
            <LocalizedText text='编辑资料' />
          </Button>
        </div>
        {user ? (
          <dl className='grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2'>
            <div><dt className='text-muted-foreground'><LocalizedText text='Username' /></dt><dd className='mt-1 break-all'>{valueOrUnset(user.user_name)}</dd></div>
            <div><dt className='text-muted-foreground'><LocalizedText text='Display name' /></dt><dd className='mt-1 break-all'>{valueOrUnset(user.nick_name)}</dd></div>
            <div><dt className='text-muted-foreground'><LocalizedText text='Email' /></dt><dd className='mt-1 break-all'>{valueOrUnset(user.email)}</dd></div>
            <div><dt className='text-muted-foreground'><LocalizedText text='Phone' /></dt><dd className='mt-1 break-all'>{valueOrUnset(user.phonenumber)}</dd></div>
            <div><dt className='text-muted-foreground'><LocalizedText text='Sex' /></dt><dd className='mt-1'><LocalizedText text={sexLabel ?? 'Not set'} /></dd></div>
            <div><dt className='text-muted-foreground'><LocalizedText text='Avatar URL' /></dt><dd className='mt-1 break-all'>{valueOrUnset(user.avatar)}</dd></div>
          </dl>
        ) : (
          <p role='alert' className='rounded-lg border border-dashed p-4 text-sm text-destructive'>
            <LocalizedText text='The current account is not loaded. Profile values cannot be confirmed.' />
          </p>
        )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[min(85vh,44rem)] overflow-y-auto sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle><LocalizedText text='Edit profile' /></DialogTitle>
            <DialogDescription><LocalizedText text='PATCH /account/profile updates the current global account and returns the saved AuthUser.' /></DialogDescription>
          </DialogHeader>
          <ProfileForm onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
      </div>
    </ContentSection>
  )
}
