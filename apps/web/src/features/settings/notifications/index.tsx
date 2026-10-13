import { useState } from 'react'
import { ContentSection } from '../components/content-section'
import { NotificationsForm } from './notifications-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LocalizedText } from '@/components/localized-text'

export function SettingsNotifications() {
  const [open, setOpen] = useState(false)
  return (
    <ContentSection
      title='Notifications'
      desc='Configure how you receive notifications.'
    >
      <div className='space-y-4'>
      <div className='flex flex-col items-start gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <p className='font-medium'><LocalizedText text='通知偏好' /></p>
          <p className='text-sm text-muted-foreground'><LocalizedText text='配置消息、邮件和移动端通知。' /></p>
        </div>
        <Button className='w-full sm:w-auto' variant='outline' onClick={() => setOpen(true)}><LocalizedText text='编辑通知' /></Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[min(88vh,52rem)] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle><LocalizedText text='编辑通知偏好' /></DialogTitle>
            <DialogDescription><LocalizedText text='选择你希望接收的通知类型。' /></DialogDescription>
          </DialogHeader>
          <NotificationsForm onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
      </div>
    </ContentSection>
  )
}
