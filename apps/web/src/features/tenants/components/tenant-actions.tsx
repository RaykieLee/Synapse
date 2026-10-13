import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Archive, CalendarRange, Pencil } from 'lucide-react'
import type { Tenant, TenantPatchPayload, TenantStatus } from '@/api/tenants'
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
import { toIsoInput, toLocalInput } from './create-tenant-dialog'
import { LocalizedText } from '@/components/localized-text'

export function EditTenantNameDialog({
  tenant,
  onSave,
}: {
  tenant: Tenant
  onSave: (name: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <Pencil className='size-4' /> <LocalizedText text={" 编辑名称\n      "} /></Button>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle><LocalizedText text={"编辑租户名称"} /></DialogTitle>
          <DialogDescription><LocalizedText text={"名称会显示给租户内所有成员。"} /></DialogDescription>
        </DialogHeader>
        <form
          className='space-y-4'
          onSubmit={(event) => {
            event.preventDefault()
            const name = new FormData(event.currentTarget).get('name')
            if (name) onSave(String(name))
            setOpen(false)
          }}
        >
          <div className='space-y-2'>
            <Label htmlFor='tenant-name-edit'><LocalizedText text={"租户名称"} /></Label>
            <Input
              id='tenant-name-edit'
              name='name'
              required
              maxLength={120}
              defaultValue={tenant.name}
            />
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => setOpen(false)}
            >
              <LocalizedText text={"\n              取消\n            "} /></Button>
            <Button type='submit'><LocalizedText text={"保存名称"} /></Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EditTenantValidityDialog({
  tenant,
  onSave,
}: {
  tenant: Tenant
  onSave: (
    payload: Pick<TenantPatchPayload, 'valid_from' | 'valid_until'>
  ) => void
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <CalendarRange className='size-4' /> <LocalizedText text={" 编辑有效期\n      "} /></Button>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle><LocalizedText text={"编辑租户有效期"} /></DialogTitle>
          <DialogDescription>
            <LocalizedText text={"\n            有效期决定租户可以被访问的时间边界。\n          "} /></DialogDescription>
        </DialogHeader>
        <form
          className='space-y-4'
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const validFrom = toIsoInput(form.get('valid_from')) ?? null
            const validUntil = toIsoInput(form.get('valid_until')) ?? null
            if (
              validFrom &&
              validUntil &&
              new Date(validUntil) <= new Date(validFrom)
            ) {
              setError('有效期结束必须晚于有效期开始。')
              return
            }
            setError('')
            onSave({ valid_from: validFrom, valid_until: validUntil })
            setOpen(false)
          }}
        >
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='validity-from-edit'><LocalizedText text={"有效期开始"} /></Label>
              <Input
                id='validity-from-edit'
                name='valid_from'
                type='datetime-local'
                defaultValue={toLocalInput(tenant.valid_from)}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='validity-until-edit'><LocalizedText text={"有效期结束"} /></Label>
              <Input
                id='validity-until-edit'
                name='valid_until'
                type='datetime-local'
                defaultValue={toLocalInput(tenant.valid_until)}
              />
            </div>
          </div>
          {error ? <p className='text-sm text-destructive'>{error}</p> : null}
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => setOpen(false)}
            >
              <LocalizedText text={"\n              取消\n            "} /></Button>
            <Button type='submit'><LocalizedText text={"保存有效期"} /></Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TenantStatusActions({
  tenant,
  onChange,
  onArchive,
}: {
  tenant: Tenant
  onChange: (status: TenantStatus) => void
  onArchive: (tenant: Tenant) => void
}) {
  const [confirmation, setConfirmation] = useState<'suspend' | 'activate' | 'archive' | null>(null)
  if (tenant.status === 'archived') return null
  return (
    <>
      <Button
        variant={tenant.status === 'active' ? "outline" : "secondary"}
        size='sm'
        onClick={() => setConfirmation(tenant.status === 'active' ? 'suspend' : 'activate')}
      >
        {tenant.status === 'active' ? <LocalizedText text={"停用租户"} /> : <LocalizedText text={"重新启用"} />}
      </Button>
      <Button variant='outline' size='sm' onClick={() => setConfirmation('archive')}>
        <Archive className='size-4' /> <LocalizedText text={" 归档\n      "} /></Button>
      <Dialog open={Boolean(confirmation)} onOpenChange={(open) => !open && setConfirmation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmation === 'archive' ? <LocalizedText text={'归档租户'} />
                : confirmation === 'suspend' ? <LocalizedText text={'停用租户'} />
                : <LocalizedText text={'重新启用租户'} />}
            </DialogTitle>
            <DialogDescription>
              {confirmation === 'archive'
                ? '归档后租户进入终态，无法重新启用。'
                : confirmation === 'suspend'
                  ? '停用后成员暂时无法访问该租户。'
                  : '启用后成员可按有效期重新访问该租户。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setConfirmation(null)}><LocalizedText text={'取消'} /></Button>
            <Button
              variant={confirmation === 'archive' ? 'destructive' : 'default'}
              onClick={() => {
                if (confirmation === 'archive') onArchive(tenant)
                else if (confirmation) onChange(confirmation === 'suspend' ? 'suspended' : 'active')
                setConfirmation(null)
              }}
            >
              <LocalizedText text={'确认'} />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function TenantLinkButton({
  tenantId,
  label,
}: {
  tenantId: string
  label: string
}) {
  return (
    <Button asChild variant='outline' size='sm'>
      <Link to='/tenants/$tenantId' params={{ tenantId }}>
        {label}
      </Link>
    </Button>
  )
}
