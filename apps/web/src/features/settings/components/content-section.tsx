import { Separator } from '@/components/ui/separator'
import { useLocale, translate } from '@/lib/i18n'

type ContentSectionProps = {
  title: string
  desc: string
  children: React.JSX.Element
}

export function ContentSection({ title, desc, children }: ContentSectionProps) {
  const locale = useLocale()
  return (
    <div className='flex flex-1 flex-col'>
      <div className='flex-none'>
        <h3 className='text-lg font-medium'>{translate(title, locale)}</h3>
        <p className='text-sm text-muted-foreground'>{translate(desc, locale)}</p>
      </div>
      <Separator className='my-4 flex-none' />
      <div className='faded-bottom h-full w-full overflow-y-auto scroll-smooth pe-4 pb-12'>
        <div className='-mx-1 px-1.5 lg:max-w-xl'>{children}</div>
      </div>
    </div>
  )
}
