import { Download, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTasks } from './tasks-provider'
import { LocalizedText } from '@/components/localized-text'

export function TasksPrimaryButtons() {
  const { setOpen } = useTasks()
  return (
    <div className='flex gap-2'>
      <Button
        variant='outline'
        className='space-x-1'
        onClick={() => setOpen('import')}
      >
        <span><LocalizedText text={"Import"} /></span> <Download size={18} />
      </Button>
      <Button className='space-x-1' onClick={() => setOpen('create')}>
        <span><LocalizedText text={"Create"} /></span> <Plus size={18} />
      </Button>
    </div>
  )
}
