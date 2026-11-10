import { useState } from 'react'
import { ContentSection } from '../components/content-section'
import { AppearanceForm } from './appearance-form'
import { useFont } from '@/context/font-provider'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LocalizedText } from '@/components/localized-text'

export function SettingsAppearance() {
  const [open, setOpen] = useState(false)
  const { font } = useFont()
  const { theme } = useTheme()
  return (
    <ContentSection
      title='Appearance'
      desc='Customize the appearance of the app. Automatically switch between day
          and night themes.'
    >
      <div className='space-y-4'>
      <div className='flex flex-col items-start gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between'>
        <div className='space-y-1'>
          <p className='font-medium'><LocalizedText text='外观偏好' /></p>
          <p className='text-sm text-muted-foreground'>
            <LocalizedText text='主题' />: <LocalizedText text={theme === 'system' ? 'System' : theme === 'light' ? 'Light' : 'Dark'} /> · <LocalizedText text='Font' />: {font}
          </p>
          <p className='text-sm text-muted-foreground'><LocalizedText text='仅保存在此浏览器，不同步到账号或其他设备。' /></p>
        </div>
        <Button className='w-full sm:w-auto' variant='outline' onClick={() => setOpen(true)}><LocalizedText text='编辑外观' /></Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[min(88vh,52rem)] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle><LocalizedText text='编辑外观偏好' /></DialogTitle>
            <DialogDescription><LocalizedText text='选择主题和界面字体，应用于此浏览器；不会保存到账号或同步到其他设备。' /></DialogDescription>
          </DialogHeader>
          <AppearanceForm onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
      </div>
    </ContentSection>
  )
}
