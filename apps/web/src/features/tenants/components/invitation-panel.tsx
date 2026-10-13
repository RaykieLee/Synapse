import { useState } from 'react'
import { Copy, Link2, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DetailDialog } from '@/components/detail-dialog'
import { FormDialog } from '@/components/form-dialog'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DataTableSkeletonRows,
  SortableTableHead,
  sortRows,
  type TableSortState,
} from '@/components/data-table'
import {
  formatDateTime,
  tenantText,
  type CreatedTenantInvitation,
  type TenantInvitation,
} from '../types'
import { EmptyState } from './shared'
import { LocalizedText } from '@/components/localized-text'

export function InvitationPanel({
  pending,
  created,
  invitations,
  loading,
  canInviteAdmin,
  onCreate,
  onRevoke,
}: {
  pending: boolean
  created: CreatedTenantInvitation | null
  invitations: TenantInvitation[]
  loading: boolean
  canInviteAdmin: boolean
  onCreate: (payload: {
    email?: string
    user_id?: string
    tenant_role: 'admin' | 'member'
  }) => void
  onRevoke: (invitation: TenantInvitation) => void
}) {
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [target, setTarget] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [dismissedInvitationId, setDismissedInvitationId] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const [sorting, setSorting] = useState<TableSortState>(null)
  const [revokeTarget, setRevokeTarget] = useState<TenantInvitation | null>(
    null
  )
  const sortedInvitations = sortRows(
    invitations,
    sorting,
    (invitation, key) => {
      switch (key) {
        case 'target':
          return invitation.email || invitation.target_user_id
        case 'role':
          return invitation.tenant_role
        case 'expires':
          return invitation.expires_at
        case 'status':
          return invitation.expired ? 'expired' : 'pending'
        default:
          return ''
      }
    }
  )

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap justify-end'>
        <Button onClick={() => setCreateOpen(true)} disabled={pending}>
          <Link2 className='size-4' /> <LocalizedText text={" 创建邀请\n          "} />
        </Button>
      </div>
      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={<LocalizedText text={'创建租户邀请'} />}
        formAriaLabel='创建租户邀请'
        description='向指定邮箱生成租户邀请链接；对方接受后会成为租户成员。'
        submitLabel={<LocalizedText text={'创建邀请'} />}
        pending={pending}
        disabled={!target.trim()}
        onSubmit={() => {
          const value = target.trim()
          if (!value) return
          setCopyMessage('')
          onCreate({ email: value, tenant_role: canInviteAdmin ? role : 'member' })
          setCreateOpen(false)
          setTarget('')
        }}
        onCancel={() => setCreateOpen(false)}
      >
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-2'>
            <Label htmlFor='invite-target'><LocalizedText text={'成员邮箱'} /></Label>
            <Input
              id='invite-target'
              required
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              type='email'
              placeholder='name@example.com'
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='invite-role'><LocalizedText text={'租户角色'} /></Label>
            <Select
              value={canInviteAdmin ? role : 'member'}
              onValueChange={(value) => setRole(value as 'admin' | 'member')}
            >
              <SelectTrigger id='invite-role' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='member'><LocalizedText text={'成员'} /></SelectItem>
                {canInviteAdmin && <SelectItem value='admin'><LocalizedText text={'管理员'} /></SelectItem>}
              </SelectContent>
            </Select>
          </div>
        </div>
      </FormDialog>

      <Dialog
        open={Boolean(created) && created?.invitation_id !== dismissedInvitationId}
        onOpenChange={(open) => {
          if (!open && created) setDismissedInvitationId(created.invitation_id)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle><LocalizedText text='邀请链接已创建' /></DialogTitle>
            <DialogDescription>
              <LocalizedText text='请复制链接并发送给收件人；对方接受后会成为租户成员。' />
            </DialogDescription>
          </DialogHeader>
          {created && (
            <div className='space-y-4'>
              <p className='break-all rounded-md border bg-muted/30 p-3 text-sm'>
                {absoluteInviteLink(created.invite_link)}
              </p>
              <DialogFooter className='sm:justify-between'>
                <span role='status' className='text-xs text-muted-foreground'>
                  {copyMessage}
                </span>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => {
                    void copyInviteLink(created.invite_link)
                      .then(() => setCopyMessage('已复制邀请链接'))
                      .catch(() => setCopyMessage('复制失败，请手动复制'))
                  }}
                >
                  <Copy className='size-4' />
                  <LocalizedText text='复制链接' />
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className='overflow-hidden rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow className='bg-muted/35 hover:bg-muted/35'>
              <SortableTableHead label={<LocalizedText text='邀请对象' />} sortKey='target' sorting={sorting} onSortingChange={setSorting} className='ps-4' />
              <SortableTableHead label={<LocalizedText text='角色' />} sortKey='role' sorting={sorting} onSortingChange={setSorting} />
              <SortableTableHead label={<LocalizedText text='到期时间' />} sortKey='expires' sorting={sorting} onSortingChange={setSorting} />
              <SortableTableHead label={<LocalizedText text='状态' />} sortKey='status' sorting={sorting} onSortingChange={setSorting} />
              <TableHead className='w-28 pe-4 text-end'><LocalizedText text={"操作"} /></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeletonRows columnCount={5} />
            ) : sortedInvitations.length ? (
              sortedInvitations.map((invitation) => (
                <TableRow key={invitation.invitation_id}>
                  <TableCell className='ps-4'>
                    {invitation.email || (
                      <DetailDialog
                        trigger={<LocalizedText text={"已有账号邀请"} />}
                        title={<LocalizedText text={"已有账号邀请"} />}
                        description={invitation.invitation_id}
                        triggerClassName='h-auto px-0 text-sm underline'
                      >
                        <p className='text-sm'><LocalizedText text={"账号 ID："} /><code className='break-all'>{invitation.target_user_id}</code></p>
                      </DetailDialog>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant='outline'>
                      {tenantText[invitation.tenant_role]}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-xs text-muted-foreground'>
                    {formatDateTime(invitation.expires_at)}
                  </TableCell>
                  <TableCell>
                    {invitation.expired ? (
                      <Badge variant='outline'><LocalizedText text={"已过期"} /></Badge>
                    ) : (
                      <Badge
                        variant='outline'
                        className='border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
                      >
                        <LocalizedText text={"\n                        待接受\n                      "} /></Badge>
                    )}
                  </TableCell>
                  <TableCell className='pe-4'>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='text-destructive hover:bg-destructive/10'
                      onClick={() => setRevokeTarget(invitation)}
                    >
                      <Trash2 className='size-4' /> <LocalizedText text={" 撤销\n                    "} /></Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow className='hover:bg-transparent'>
                <TableCell colSpan={5} className='p-4'>
                  <EmptyState
                    title='暂无待处理邀请'
                    description='创建邀请后链接会显示在这里。'
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle><LocalizedText text={"撤销邀请"} /></AlertDialogTitle>
            <AlertDialogDescription>
              <LocalizedText text={"\n              撤销后，原邀请链接将不可使用。确定继续吗？\n            "} /></AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRevokeTarget(null)}>
              <LocalizedText text={"\n              取消\n            "} /></AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (revokeTarget) onRevoke(revokeTarget)
                setRevokeTarget(null)
              }}
            >
              <LocalizedText text={"\n              撤销邀请\n            "} /></AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function absoluteInviteLink(path: string) {
  return new URL(path, window.location.origin).toString()
}

async function copyInviteLink(path: string) {
  await navigator.clipboard.writeText(absoluteInviteLink(path))
}
