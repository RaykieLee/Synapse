import { ContentSection } from '../components/content-section'
import { Button } from '@/components/ui/button'
import { LocalizedText } from '@/components/localized-text'
import { UnavailableNotice } from '../components/unavailable-notice'

export function SettingsNotifications() {
  return (
    <ContentSection
      title='Notifications'
      desc='Notification preferences are unavailable until read, save, and real delivery are supported.'
    >
      <div className='space-y-4'>
        <div className='flex flex-col items-start gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <p className='font-medium'><LocalizedText text='通知偏好' /></p>
            <p className='text-sm text-muted-foreground'><LocalizedText text='配置消息、邮件和移动端通知。' /></p>
          </div>
          <Button
            className='w-full sm:w-auto'
            variant='outline'
            disabled
            aria-describedby='notification-settings-unavailable'
          >
            <LocalizedText text='编辑通知（暂不可用）' />
          </Button>
        </div>
        <UnavailableNotice
          id='notification-settings-unavailable'
          reason='通知偏好尚未接入读取、保存和真实投递渠道，当前不能确认或修改任何通知状态。'
        />
      </div>
    </ContentSection>
  )
}
