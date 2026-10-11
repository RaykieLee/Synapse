import { Telescope } from 'lucide-react'
import { LocalizedText } from '@/components/localized-text'

export function ComingSoon() {
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <Telescope size={72} />
        <h1 className='text-4xl leading-tight font-bold'><LocalizedText text={"Coming Soon!"} /></h1>
        <p className='text-center text-muted-foreground'>
          <LocalizedText text={"\n          This page has not been created yet. "} /><br />
          <LocalizedText text={"\n          Stay tuned though!\n        "} /></p>
      </div>
    </div>
  )
}
