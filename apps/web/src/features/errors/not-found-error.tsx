import { useNavigate, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { LocalizedText } from '@/components/localized-text'

export function NotFoundError() {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <h1 className='text-[7rem] leading-tight font-bold'><LocalizedText text={"404"} /></h1>
        <span className='font-medium'><LocalizedText text={"Oops! Page Not Found!"} /></span>
        <p className='text-center text-muted-foreground'>
          <LocalizedText text={"\n          It seems like the page you're looking for "} /><br />
          <LocalizedText text={"\n          does not exist or might have been removed.\n        "} /></p>
        <div className='mt-6 flex gap-4'>
          <Button variant='outline' onClick={() => history.go(-1)}>
            <LocalizedText text={"\n            Go Back\n          "} /></Button>
          <Button onClick={() => navigate({ to: '/' })}><LocalizedText text={"Back to Home"} /></Button>
        </div>
      </div>
    </div>
  )
}
