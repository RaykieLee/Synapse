import { Button } from '@/components/ui/button'
import { LocalizedText } from '@/components/localized-text'

export function MaintenanceError() {
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <h1 className='text-[7rem] leading-tight font-bold'><LocalizedText text={"503"} /></h1>
        <span className='font-medium'><LocalizedText text={"Website is under maintenance!"} /></span>
        <p className='text-center text-muted-foreground'>
          <LocalizedText text={"\n          The site is not available at the moment. "} /><br />
          <LocalizedText text={"\n          We'll be back online shortly.\n        "} /></p>
        <div className='mt-6 flex gap-4'>
          <Button variant='outline'><LocalizedText text={"Learn more"} /></Button>
        </div>
      </div>
    </div>
  )
}
