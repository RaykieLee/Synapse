import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { LocalizedText } from '@/components/localized-text'

export function RecentSales() {
  return (
    <div className='space-y-8'>
      <div className='flex items-center gap-4'>
        <Avatar className='h-9 w-9'>
          <AvatarImage src='/avatars/01.png' alt='Avatar' />
          <AvatarFallback><LocalizedText text={"OM"} /></AvatarFallback>
        </Avatar>
        <div className='flex flex-1 flex-wrap items-center justify-between'>
          <div className='space-y-1'>
            <p className='text-sm leading-none font-medium'><LocalizedText text={"Olivia Martin"} /></p>
            <p className='text-sm text-muted-foreground'>
              <LocalizedText text={"\n              olivia.martin@email.com\n            "} /></p>
          </div>
          <div className='font-medium'><LocalizedText text={"+$1,999.00"} /></div>
        </div>
      </div>
      <div className='flex items-center gap-4'>
        <Avatar className='flex h-9 w-9 items-center justify-center space-y-0 border'>
          <AvatarImage src='/avatars/02.png' alt='Avatar' />
          <AvatarFallback><LocalizedText text={"JL"} /></AvatarFallback>
        </Avatar>
        <div className='flex flex-1 flex-wrap items-center justify-between'>
          <div className='space-y-1'>
            <p className='text-sm leading-none font-medium'><LocalizedText text={"Jackson Lee"} /></p>
            <p className='text-sm text-muted-foreground'>
              <LocalizedText text={"\n              jackson.lee@email.com\n            "} /></p>
          </div>
          <div className='font-medium'><LocalizedText text={"+$39.00"} /></div>
        </div>
      </div>
      <div className='flex items-center gap-4'>
        <Avatar className='h-9 w-9'>
          <AvatarImage src='/avatars/03.png' alt='Avatar' />
          <AvatarFallback><LocalizedText text={"IN"} /></AvatarFallback>
        </Avatar>
        <div className='flex flex-1 flex-wrap items-center justify-between'>
          <div className='space-y-1'>
            <p className='text-sm leading-none font-medium'><LocalizedText text={"Isabella Nguyen"} /></p>
            <p className='text-sm text-muted-foreground'>
              <LocalizedText text={"\n              isabella.nguyen@email.com\n            "} /></p>
          </div>
          <div className='font-medium'><LocalizedText text={"+$299.00"} /></div>
        </div>
      </div>

      <div className='flex items-center gap-4'>
        <Avatar className='h-9 w-9'>
          <AvatarImage src='/avatars/04.png' alt='Avatar' />
          <AvatarFallback><LocalizedText text={"WK"} /></AvatarFallback>
        </Avatar>
        <div className='flex flex-1 flex-wrap items-center justify-between'>
          <div className='space-y-1'>
            <p className='text-sm leading-none font-medium'><LocalizedText text={"William Kim"} /></p>
            <p className='text-sm text-muted-foreground'><LocalizedText text={"will@email.com"} /></p>
          </div>
          <div className='font-medium'><LocalizedText text={"+$99.00"} /></div>
        </div>
      </div>

      <div className='flex items-center gap-4'>
        <Avatar className='h-9 w-9'>
          <AvatarImage src='/avatars/05.png' alt='Avatar' />
          <AvatarFallback><LocalizedText text={"SD"} /></AvatarFallback>
        </Avatar>
        <div className='flex flex-1 flex-wrap items-center justify-between'>
          <div className='space-y-1'>
            <p className='text-sm leading-none font-medium'><LocalizedText text={"Sofia Davis"} /></p>
            <p className='text-sm text-muted-foreground'>
              <LocalizedText text={"\n              sofia.davis@email.com\n            "} /></p>
          </div>
          <div className='font-medium'><LocalizedText text={"+$39.00"} /></div>
        </div>
      </div>
    </div>
  )
}
