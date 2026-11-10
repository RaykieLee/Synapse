import { LocalizedText } from '@/components/localized-text'

type UnavailableNoticeProps = {
  id: string
  reason: string
}

export function UnavailableNotice({ id, reason }: UnavailableNoticeProps) {
  return (
    <div
      id={id}
      role='status'
      aria-live='polite'
      className='rounded-lg border border-dashed bg-muted/30 p-4'
    >
      <p className='font-medium'>
        <LocalizedText text='暂不可用' />
      </p>
      <p className='mt-1 text-sm text-muted-foreground'>
        <LocalizedText text={reason} />
      </p>
    </div>
  )
}
