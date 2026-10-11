import { useNavigate, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { LocalizedText } from '@/components/localized-text'

export function ForbiddenError() {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <h1 className='text-[7rem] leading-tight font-bold'><LocalizedText text={"403"} /></h1>
        <span className='font-medium'><LocalizedText text={"Access Forbidden"} /></span>
        <p className='text-center text-muted-foreground'>
          <LocalizedText text={"\n          You don't have necessary permission "} /><br />
          <LocalizedText text={"\n          to view this resource.\n        "} /></p>
        <div className='mt-6 flex gap-4'>
          <Button variant='outline' onClick={() => history.go(-1)}>
            <LocalizedText text={"\n            Go Back\n          "} /></Button>
          <Button onClick={() => navigate({ to: '/' })}><LocalizedText text={"Back to Home"} /></Button>
        </div>
      </div>
    </div>
  )
}
