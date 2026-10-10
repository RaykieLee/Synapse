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
  formatDateTime,
  tenantText,
  type CreatedTenantInvitation,
  type TenantInvitation,
} from '../types'
import { EmptyState, TableSkeleton } from './shared'

export function InvitationPanel({
  pending,
  created,
  invitations,
  loading,
  onCreate,
  onRevoke,
}: {
  pending: boolean
  created: CreatedTenantInvitation | null
  invitations: TenantInvitation[]
  loading: boolean
  onCreate: (payload: {
    email?: string
    user_id?: string
    tenant_role: 'admin' | 'member'
  }) => void
  onRevoke: (invitation: TenantInvitation) => void
}) {
  const [kind, setKind] = useState<'email' | 'user_id'>('email')
  const [target, setTarget] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<TenantInvitation | null>(
    null
  )

  return (
    <div className='space-y-4'>
      <form
        className='grid gap-3 rounded-lg border bg-muted/20 p-4 lg:grid-cols-[minmax(0,1fr)_180px_auto]'
        onSubmit={(event) => {
          event.preventDefault()
          const value = target.trim()
          if (!value) return
          onCreate({
            [kind]: value,
            tenant_role: 'member',
          })
        }}
      >
        <div className='space-y-2'>
          <Label htmlFor='invite-target'>邀请对象</Label>
          <div className='flex gap-2'>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as 'email' | 'user_id')}
            >
              <SelectTrigger className='w-32'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='email'>邮箱</SelectItem>
                <SelectItem value='user_id'>账号 ID</SelectItem>
              </SelectContent>
            </Select>
            <Input
              id='invite-target'
              required
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              type={kind === 'email' ? 'email' : 'text'}
              inputMode={kind === 'user_id' ? 'numeric' : undefined}
              pattern={kind === 'user_id' ? '[0-9]+' : undefined}
              placeholder={
                kind === 'email' ? 'name@example.com' : '全局账号 ID'
              }
            />
          </div>
        </div>
        <div className='space-y-2'>
          <Label htmlFor='invite-role'>租户角色</Label>
          <div
            id='invite-role'
            className='flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground'
          >
            成员
          </div>
        </div>
        <div className='flex items-end'>
          <Button type='submit' className='w-full lg:w-auto' disabled={pending}>
            <Link2 className='size-4' /> 创建邀请
          </Button>
        </div>
      </form>

      {created ? (
        <div className='rounded-lg border border-primary/30 bg-primary/5 p-4'>
          <p className='text-sm font-medium'>邀请链接已创建</p>
          <p className='mt-1 text-xs break-all text-muted-foreground'>
            {absoluteInviteLink(created.invite_link)}
          </p>
          <div className='mt-3 flex flex-wrap items-center gap-3'>
            <Button
              size='sm'
              variant='outline'
              onClick={() => {
                void copyInviteLink(created.invite_link)
                  .then(() => setCopyMessage('已复制邀请链接'))
                  .catch(() => setCopyMessage('复制失败，请手动复制'))
              }}
            >
              <Copy className='size-4' /> 复制链接
            </Button>
            <span role='status' className='text-xs text-muted-foreground'>
              {copyMessage}
            </span>
          </div>
        </div>
      ) : null}

      <div className='overflow-hidden rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow className='bg-muted/35 hover:bg-muted/35'>
              <TableHead className='h-11 ps-4'>邀请对象</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>到期时间</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className='w-28 pe-4 text-end'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className='p-0'>
                  <TableSkeleton columns={4} />
                </TableCell>
              </TableRow>
            ) : invitations.length ? (
              invitations.map((invitation) => (
                <TableRow key={invitation.invitation_id}>
                  <TableCell className='ps-4'>
                    {invitation.email || `账号 ${invitation.target_user_id}`}
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
                      <Badge variant='outline'>已过期</Badge>
                    ) : (
                      <Badge
                        variant='outline'
                        className='border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
                      >
                        待接受
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className='pe-4'>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='text-destructive hover:bg-destructive/10'
                      onClick={() => setRevokeTarget(invitation)}
                    >
                      <Trash2 className='size-4' /> 撤销
                    </Button>
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
            <AlertDialogTitle>撤销邀请</AlertDialogTitle>
            <AlertDialogDescription>
              撤销后，原邀请链接将不可使用。确定继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRevokeTarget(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (revokeTarget) onRevoke(revokeTarget)
                setRevokeTarget(null)
              }}
            >
              撤销邀请
            </AlertDialogAction>
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
