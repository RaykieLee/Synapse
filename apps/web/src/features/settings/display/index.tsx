import { ContentSection } from '../components/content-section'
import { Button } from '@/components/ui/button'
import { LocalizedText } from '@/components/localized-text'
import { UnavailableNotice } from '../components/unavailable-notice'

export function SettingsDisplay() {
  return (
    <ContentSection
      title='Display'
      desc='Sidebar display preferences cannot be read or saved yet.'
    >
      <div className='space-y-4'>
        <div className='flex flex-col items-start gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <p className='font-medium'><LocalizedText text='侧栏显示' /></p>
            <p className='text-sm text-muted-foreground'><LocalizedText text='选择侧栏中需要显示的项目。' /></p>
          </div>
          <Button
            className='w-full sm:w-auto'
            variant='outline'
            disabled
            aria-describedby='display-settings-unavailable'
          >
            <LocalizedText text='编辑显示设置（暂不可用）' />
          </Button>
        </div>
        <UnavailableNotice
          id='display-settings-unavailable'
          reason='侧栏显示偏好尚未接入读取和保存 API，当前没有可确认的账号设置值。'
        />
      </div>
    </ContentSection>
  )
}
