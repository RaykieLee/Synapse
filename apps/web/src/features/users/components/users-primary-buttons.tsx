import { MailPlus, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUsers } from './users-provider'
import { LocalizedText } from '@/components/localized-text'

export function UsersPrimaryButtons() {
  const { setOpen } = useUsers()
  return (
    <div className='flex gap-2'>
      <Button
        variant='outline'
        className='space-x-1'
        onClick={() => setOpen('invite')}
      >
        <span><LocalizedText text={"Invite User"} /></span> <MailPlus size={18} />
      </Button>
      <Button className='space-x-1' onClick={() => setOpen('add')}>
        <span><LocalizedText text={"Add User"} /></span> <UserPlus size={18} />
      </Button>
    </div>
  )
}
