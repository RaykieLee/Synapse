import { Link, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { LocalizedText } from '@/components/localized-text'

export function NotFoundError() {
  const { history } = useRouter()
  return (
    <main className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center'>
        <h1 className='text-4xl font-bold sm:text-5xl'>
          <LocalizedText text={'页面不存在或已移除'} />
        </h1>
        <p className='max-w-xl text-muted-foreground'>
          <LocalizedText
            text={
              '此页面不存在或已移除。你可以返回工作台，或从正式导航打开当前账号可访问的功能。'
            }
          />
        </p>
        <div className='mt-6 flex flex-wrap justify-center gap-4'>
          <Button variant='outline' onClick={() => history.go(-1)}>
            <LocalizedText text={'返回上一页'} />
          </Button>
          <Button asChild>
            <Link to='/'>
              <LocalizedText text={'返回工作台'} />
            </Link>
          </Button>
        </div>
      </div>
    </main>
  )
}