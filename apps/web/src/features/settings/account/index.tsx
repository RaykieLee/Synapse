import { useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { ContentSection } from '../components/content-section'
import { AccountForm } from './account-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LocalizedText } from '@/components/localized-text'

export function SettingsAccount() {
  const [open, setOpen] = useState(false)
  const user = useAuthStore((s) => s.auth.user)
  return (
    <ContentSection
      title='Account'
      desc='Change the password for the current account.'
    >
      <div className='space-y-4'>
        <div className='flex flex-col items-start gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <p className='font-medium'><LocalizedText text='账号安全' /></p>
            <p className='text-sm text-muted-foreground'><LocalizedText text='修改密码后需要重新登录；当前没有安全通知或设备管理能力。' /></p>
          </div>
          <Button className='w-full sm:w-auto' variant='outline' disabled={!user} onClick={() => setOpen(true)}>
            <LocalizedText text='Change password' />
          </Button>
        </div>
        {user ? (
          <dl className='grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2'>
            <div><dt className='text-muted-foreground'><LocalizedText text='Username' /></dt><dd className='mt-1 break-all'>{user.user_name}</dd></div>
            <div><dt className='text-muted-foreground'><LocalizedText text='Email' /></dt><dd className='mt-1 break-all'>{user.email || <LocalizedText text='Not set' />}</dd></div>
          </dl>
        ) : (
          <p role='alert' className='rounded-lg border border-dashed p-4 text-sm text-destructive'>
            <LocalizedText text='The current account is not loaded. Account values cannot be confirmed.' />
          </p>
        )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[min(85vh,44rem)] overflow-y-auto sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle><LocalizedText text='Change password' /></DialogTitle>
            <DialogDescription><LocalizedText text='Enter the current password and a new password with at least 12 characters. A successful change invalidates the current session.' /></DialogDescription>
          </DialogHeader>
          <AccountForm />
        </DialogContent>
      </Dialog>
      </div>
    </ContentSection>
  )
}
