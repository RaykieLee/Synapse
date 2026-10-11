import { useState } from 'react'
import { CalendarRange, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { GlobalUser } from '@/api/users'
import { OwnerPicker } from './owner-picker'
import { LocalizedText } from '@/components/localized-text'

export function toIsoInput(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text ? new Date(text).toISOString() : undefined
}

export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function CreateTenantDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (payload: {
    slug: string
    name: string
    first_owner_user_id: string
    valid_from?: string
    valid_until?: string
  }) => void
}) {
  const [validityError, setValidityError] = useState('')
  const [owner, setOwner] = useState<GlobalUser | null>(null)
  const [ownerError, setOwnerError] = useState('')

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        setOwner(null)
        setOwnerError('')
        setValidityError('')
      }
      onOpenChange(nextOpen)
    }}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle><LocalizedText text={"创建租户"} /></DialogTitle>
          <DialogDescription>
            <LocalizedText text={"\n            创建租户会同步创建首位所有者、默认空间和初始成员关系。\n          "} /></DialogDescription>
        </DialogHeader>
        <form
          className='grid gap-4'
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const validFrom = toIsoInput(form.get('valid_from'))
            const validUntil = toIsoInput(form.get('valid_until'))
            if (!owner) {
              setOwnerError('请选择首位所有者。')
              return
            }
            setOwnerError('')
            if (
              validFrom &&
              validUntil &&
              new Date(validUntil) <= new Date(validFrom)
            ) {
              setValidityError('有效期结束必须晚于有效期开始。')
              return
            }
            setValidityError('')
            onSubmit({
              slug: String(form.get('slug')),
              name: String(form.get('name')),
              first_owner_user_id: owner.user_id,
              valid_from: validFrom,
              valid_until: validUntil,
            })
          }}
        >
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='tenant-slug'><LocalizedText text={"租户标识"} /></Label>
              <Input
                id='tenant-slug'
                name='slug'
                required
                pattern='[a-z0-9]+(?:-[a-z0-9]+)*'
                maxLength={64}
                placeholder='acme'
              />
              <p className='text-xs text-muted-foreground'>
                <LocalizedText text={"\n                小写字母、数字和中划线。\n              "} /></p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='tenant-name'><LocalizedText text={"租户名称"} /></Label>
              <Input
                id='tenant-name'
                name='name'
                required
                maxLength={120}
                placeholder='Acme 团队'
              />
            </div>
          </div>
          <OwnerPicker value={owner} onChange={(user) => { setOwner(user); setOwnerError('') }} />
          {ownerError ? <p role='alert' className='text-sm text-destructive'>{ownerError}</p> : null}
          <div className='rounded-lg border bg-muted/25 p-4'>
            <div className='mb-3 flex items-center gap-2 text-sm font-medium'>
              <CalendarRange className='size-4 text-muted-foreground' />
              <LocalizedText text={"\n              租户有效期\n            "} /></div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='valid-from'><LocalizedText text={"有效期开始"} /></Label>
                <Input
                  id='valid-from'
                  name='valid_from'
                  type='datetime-local'
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='valid-until'><LocalizedText text={"有效期结束"} /></Label>
                <Input
                  id='valid-until'
                  name='valid_until'
                  type='datetime-local'
                />
              </div>
            </div>
            <p className='mt-2 text-xs text-muted-foreground'>
              <LocalizedText text={"\n              留空表示不限制对应边界。\n            "} /></p>
            {validityError ? (
              <p className='mt-2 text-xs text-destructive'>{validityError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              <LocalizedText text={"\n              取消\n            "} /></Button>
            <Button type='submit' disabled={pending}>
              <Plus className='size-4' /> <LocalizedText text={" 创建租户\n            "} /></Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
