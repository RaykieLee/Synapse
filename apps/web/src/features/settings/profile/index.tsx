import { useState } from 'react'
import { ContentSection } from '../components/content-section'
import { ProfileForm } from './profile-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LocalizedText } from '@/components/localized-text'

export function SettingsProfile() {
  const [open, setOpen] = useState(false)
  return (
    <ContentSection
      title='Profile'
      desc='This is how others will see you on the site.'
    >
      <div className='space-y-4'>
      <div className='flex flex-col items-start gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <p className='font-medium'><LocalizedText text='个人资料' /></p>
          <p className='text-sm text-muted-foreground'><LocalizedText text='维护昵称、邮箱、电话、性别和头像。' /></p>
        </div>
        <Button className='w-full sm:w-auto' variant='outline' onClick={() => setOpen(true)}><LocalizedText text='编辑资料' /></Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[min(85vh,44rem)] overflow-y-auto sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle><LocalizedText text='编辑个人资料' /></DialogTitle>
            <DialogDescription><LocalizedText text='保存后会立即更新当前账号资料。' /></DialogDescription>
          </DialogHeader>
          <ProfileForm onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
      </div>
    </ContentSection>
  )
}
