import { useState } from 'react'
import { ContentSection } from '../components/content-section'
import { AccountForm } from './account-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LocalizedText } from '@/components/localized-text'

export function SettingsAccount() {
  const [open, setOpen] = useState(false)
  return (
    <ContentSection
      title='Account'
      desc='Update your account settings. Set your preferred language and
          timezone.'
    >
      <div className='space-y-4'>
      <div className='flex flex-col items-start gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <p className='font-medium'><LocalizedText text='账号安全' /></p>
          <p className='text-sm text-muted-foreground'><LocalizedText text='修改密码后需要重新登录。' /></p>
        </div>
        <Button className='w-full sm:w-auto' variant='outline' onClick={() => setOpen(true)}><LocalizedText text='修改密码' /></Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[min(85vh,44rem)] overflow-y-auto sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle><LocalizedText text='修改密码' /></DialogTitle>
            <DialogDescription><LocalizedText text='请输入当前密码和至少 12 个字符的新密码。' /></DialogDescription>
          </DialogHeader>
          <AccountForm />
        </DialogContent>
      </Dialog>
      </div>
    </ContentSection>
  )
}
