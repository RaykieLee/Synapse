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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>创建租户</DialogTitle>
          <DialogDescription>
            创建租户会同步创建首位所有者、默认空间和初始成员关系。
          </DialogDescription>
        </DialogHeader>
        <form
          className='grid gap-4'
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const validFrom = toIsoInput(form.get('valid_from'))
            const validUntil = toIsoInput(form.get('valid_until'))
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
              first_owner_user_id: String(form.get('owner')),
              valid_from: validFrom,
              valid_until: validUntil,
            })
          }}
        >
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='tenant-slug'>租户标识</Label>
              <Input
                id='tenant-slug'
                name='slug'
                required
                pattern='[a-z0-9]+(?:-[a-z0-9]+)*'
                maxLength={64}
                placeholder='acme'
              />
              <p className='text-xs text-muted-foreground'>
                小写字母、数字和中划线。
              </p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='tenant-name'>租户名称</Label>
              <Input
                id='tenant-name'
                name='name'
                required
                maxLength={120}
                placeholder='Acme 团队'
              />
            </div>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='tenant-owner'>首位所有者的全局账号 ID</Label>
            <Input
              id='tenant-owner'
              name='owner'
              required
              inputMode='numeric'
              pattern='[0-9]+'
              placeholder='1'
            />
          </div>
          <div className='rounded-lg border bg-muted/25 p-4'>
            <div className='mb-3 flex items-center gap-2 text-sm font-medium'>
              <CalendarRange className='size-4 text-muted-foreground' />
              租户有效期
            </div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='valid-from'>有效期开始</Label>
                <Input
                  id='valid-from'
                  name='valid_from'
                  type='datetime-local'
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='valid-until'>有效期结束</Label>
                <Input
                  id='valid-until'
                  name='valid_until'
                  type='datetime-local'
                />
              </div>
            </div>
            <p className='mt-2 text-xs text-muted-foreground'>
              留空表示不限制对应边界。
            </p>
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
              取消
            </Button>
            <Button type='submit' disabled={pending}>
              <Plus className='size-4' /> 创建租户
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
