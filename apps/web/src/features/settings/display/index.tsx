import { useState } from 'react'
import { ContentSection } from '../components/content-section'
import { DisplayForm } from './display-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LocalizedText } from '@/components/localized-text'

export function SettingsDisplay() {
  const [open, setOpen] = useState(false)
  return (
    <ContentSection
      title='Display'
      desc="Turn items on or off to control what's displayed in the app."
    >
      <div className='space-y-4'>
      <div className='flex flex-col items-start gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <p className='font-medium'><LocalizedText text='侧栏显示' /></p>
          <p className='text-sm text-muted-foreground'><LocalizedText text='选择侧栏中需要显示的项目。' /></p>
        </div>
        <Button className='w-full sm:w-auto' variant='outline' onClick={() => setOpen(true)}><LocalizedText text='编辑显示设置' /></Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[min(85vh,44rem)] overflow-y-auto sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle><LocalizedText text='编辑显示设置' /></DialogTitle>
            <DialogDescription><LocalizedText text='保存后更新侧栏显示偏好。' /></DialogDescription>
          </DialogHeader>
          <DisplayForm onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
      </div>
    </ContentSection>
  )
}
