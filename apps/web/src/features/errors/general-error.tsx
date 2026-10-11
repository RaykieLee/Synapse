import { useNavigate, useRouter } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { LocalizedText } from '@/components/localized-text'

type GeneralErrorProps = React.HTMLAttributes<HTMLDivElement> & {
  minimal?: boolean
}

export function GeneralError({
  className,
  minimal = false,
}: GeneralErrorProps) {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className={cn('h-svh w-full', className)}>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        {!minimal && (
          <h1 className='text-[7rem] leading-tight font-bold'><LocalizedText text={"500"} /></h1>
        )}
        <span className='font-medium'><LocalizedText text={"Oops! Something went wrong "} />{`:')`}</span>
        <p className='text-center text-muted-foreground'>
          <LocalizedText text={"\n          We apologize for the inconvenience. "} /><br /> <LocalizedText text={" Please try again later.\n        "} /></p>
        {!minimal && (
          <div className='mt-6 flex gap-4'>
            <Button variant='outline' onClick={() => history.go(-1)}>
              <LocalizedText text={"\n              Go Back\n            "} /></Button>
            <Button onClick={() => navigate({ to: '/' })}><LocalizedText text={"Back to Home"} /></Button>
          </div>
        )}
      </div>
    </div>
  )
}
