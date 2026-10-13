import * as React from 'react'
import { MoreHorizontal, RotateCcw } from 'lucide-react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { DetailDialog } from '@/components/detail-dialog'
import type { Member, MemberRole } from '@/api/tenants'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime, tenantText } from '../types'
import { EmptyState, TableSkeleton } from './shared'
import { LocalizedText } from '@/components/localized-text'
import { useLocaleText } from '@/lib/i18n'

const statusStyles: Record<Member['status'], string> = {
  active:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  suspended:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  removed:
    'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
}

export function MemberStatusBadge({ status }: { status: Member['status'] }) {
  return (
    <Badge variant='outline' className={statusStyles[status]}>
      {tenantText[status]}
    </Badge>
  )
}

export function MemberTable({
  members,
  canManage,
  currentRole,
  loading,
  onRoleChange,
  onStatusChange,
  onRemove,
  onReactivate,
  mutationPending,
  mutationError,
  renderCustomRole,
}: {
  members: Member[]
  canManage: boolean
  currentRole: 'owner' | 'admin' | 'member' | null
  loading: boolean
  onRoleChange: (member: Member, role: MemberRole) => Promise<unknown>
  onStatusChange: (member: Member, status: Member['status']) => Promise<unknown>
  onRemove: (member: Member) => Promise<unknown>
  onReactivate: (member: Member) => Promise<unknown>
  mutationPending: boolean
  mutationError: string
  renderCustomRole: (member: Member) => React.ReactNode
}) {
  const columnCount = canManage ? 6 : 5
  const [roleTarget, setRoleTarget] = React.useState<{
    member: Member
    role: MemberRole
  } | null>(null)
  const [statusTarget, setStatusTarget] = React.useState<{
    member: Member
    status: Member['status']
    action: 'suspend' | 'remove' | 'reactivate'
  } | null>(null)

  return (
    <div className='overflow-hidden border-t'>
      <Table>
        <TableHeader>
          <TableRow className='bg-muted/35 hover:bg-muted/35'>
            <TableHead className='h-11 ps-4'><LocalizedText text={"成员"} /></TableHead>
            <TableHead><LocalizedText text={"角色"} /></TableHead>
            <TableHead><LocalizedText text={"自定义角色"} /></TableHead>
            <TableHead><LocalizedText text={"状态"} /></TableHead>
            <TableHead className='hidden xl:table-cell'><LocalizedText text={"加入时间"} /></TableHead>
            {canManage ? (
              <TableHead className='w-20 pe-4 text-end'><LocalizedText text={"管理"} /></TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={columnCount} className='p-0'>
                <TableSkeleton columns={5} />
              </TableCell>
            </TableRow>
          ) : members.length ? (
            members.map((member) => (
              <TableRow key={member.user_id} className='group'>
                <TableCell className='max-w-64 ps-4'>
                  <div className='space-y-0.5'>
                    <p className='font-medium'>
                      {member.nick_name || member.user_name}
                    </p>
                    <p className='text-xs text-muted-foreground'>
                      {member.email || member.user_name}
                    </p>
                    <DetailDialog
                      trigger={<LocalizedText text={"技术信息"} />}
                      title={<LocalizedText text={"成员技术信息"} />}
                      description={member.nick_name || member.user_name}
                      triggerClassName='mt-1 h-auto px-0 py-0 text-xs text-muted-foreground underline'
                    >
                      <div className='space-y-2 text-sm'>
                        <p><LocalizedText text={"账号 ID："} /><code className='break-all'>{member.user_id}</code></p>
                        <Button size='sm' variant='outline' onClick={() => navigator.clipboard.writeText(member.user_id)}><LocalizedText text={"复制 ID"} /></Button>
                      </div>
                    </DetailDialog>
                  </div>
                </TableCell>
                <TableCell>
                  {canManage && member.tenant_role !== 'owner' ? (
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => setRoleTarget({ member, role: member.tenant_role })}
                    >
                      {tenantText[member.tenant_role]}
                    </Button>
                  ) : (
                    <Badge variant='outline'>
                      {tenantText[member.tenant_role]}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className='max-w-56 text-xs'>
                  {renderCustomRole(member)}
                </TableCell>
                <TableCell>
                  <MemberStatusBadge status={member.status} />
                </TableCell>
                <TableCell className='hidden text-xs text-muted-foreground xl:table-cell'>
                  {formatDateTime(member.joined_at)}
                </TableCell>
                {canManage ? (
                  <TableCell className='pe-4'>
                    {member.tenant_role === 'owner' ? (
                      <span className='text-xs text-muted-foreground'>
                        <LocalizedText text={"\n                        受保护\n                      "} /></span>
                    ) : member.status === 'active' ? (
                      <MemberRowActions
                        member={member}
                        onStatusConfirm={(status) =>
                          setStatusTarget({ member, status, action: status === 'suspended' ? 'suspend' : 'remove' })
                        }
                      />
                    ) : member.status === 'removed' ||
                      member.status === 'suspended' ? (
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => setStatusTarget({ member, status: 'active', action: 'reactivate' })}
                      >
                        <RotateCcw className='size-4' /> <LocalizedText text={" 重新加入\n                      "} /></Button>
                    ) : (
                      <span className='text-xs text-muted-foreground'><LocalizedText text={"—"} /></span>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))
          ) : (
            <TableRow className='hover:bg-transparent'>
              <TableCell colSpan={columnCount} className='p-4'>
                <EmptyState
                  title='暂无成员'
                  description='添加已有账号或创建邀请链接。'
                />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Dialog
        open={Boolean(roleTarget)}
        onOpenChange={(open) => {
          if (!open && !mutationPending) setRoleTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle><LocalizedText text={'编辑成员角色'} /></DialogTitle>
            <DialogDescription>
              {roleTarget?.member.nick_name || roleTarget?.member.user_name}
              <LocalizedText text={' · 角色变化会立即影响租户权限。'} />
            </DialogDescription>
          </DialogHeader>
          {mutationError && (
            <p role='alert' className='text-sm text-destructive'>
              {mutationError}
            </p>
          )}
          <div className='space-y-2'>
            <Label htmlFor='member-role'><LocalizedText text={'租户角色'} /></Label>
            <LocalizedNativeSelect
              id='member-role'
              className='h-10 w-full rounded-md border bg-background px-3 text-sm'
              disabled={mutationPending}
              value={roleTarget?.role ?? 'member'}
              onChange={(event) =>
                setRoleTarget((current) =>
                  current ? { ...current, role: event.target.value as MemberRole } : current,
                )
              }
            >
              <option value='member'><LocalizedText text={'成员'} /></option>
              <option value='admin'><LocalizedText text={'管理员'} /></option>
              {currentRole === 'owner' ? (
                <option value='owner'><LocalizedText text={'所有者'} /></option>
              ) : null}
            </LocalizedNativeSelect>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              disabled={mutationPending}
              onClick={() => setRoleTarget(null)}
            >
              <LocalizedText text={'取消'} />
            </Button>
            <Button
              disabled={
                mutationPending ||
                roleTarget?.role === roleTarget?.member.tenant_role
              }
              onClick={async () => {
                if (!roleTarget) return
                try {
                  await onRoleChange(roleTarget.member, roleTarget.role)
                  setRoleTarget(null)
                } catch {
                  // Keep the editor open so the mutation error remains actionable.
                }
              }}
            >
              {mutationPending ? (
                <LocalizedText text={'保存中…'} />
              ) : (
                <LocalizedText text={'保存角色'} />
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(statusTarget)}
        onOpenChange={(open) => {
          if (!open && !mutationPending) setStatusTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {statusTarget?.action === 'suspend' ? (
                <LocalizedText text={'暂停成员'} />
              ) : statusTarget?.action === 'remove' ? (
                <LocalizedText text={'移除成员'} />
              ) : (
                <LocalizedText text={'重新加入成员'} />
              )}
            </DialogTitle>
            <DialogDescription>
              {statusTarget?.member.nick_name || statusTarget?.member.user_name}
              <LocalizedText text={' · 确认后才会提交状态变更。'} />
            </DialogDescription>
          </DialogHeader>
          {mutationError && (
            <p role='alert' className='text-sm text-destructive'>
              {mutationError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant='outline'
              disabled={mutationPending}
              onClick={() => setStatusTarget(null)}
            >
              <LocalizedText text={'取消'} />
            </Button>
            <Button
              variant={statusTarget?.action === 'remove' ? 'destructive' : 'default'}
              disabled={mutationPending}
              onClick={async () => {
                if (!statusTarget) return
                try {
                  if (statusTarget.action === 'reactivate')
                    await onReactivate(statusTarget.member)
                  else if (statusTarget.action === 'remove')
                    await onRemove(statusTarget.member)
                  else
                    await onStatusChange(
                      statusTarget.member,
                      statusTarget.status,
                    )
                  setStatusTarget(null)
                } catch {
                  // Keep the confirmation open so the mutation error is visible.
                }
              }}
            >
              {mutationPending ? (
                <LocalizedText text={'处理中…'} />
              ) : (
                <LocalizedText text={'确认'} />
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MemberRowActions({
  member,
  onStatusConfirm,
}: {
  member: Member
  onStatusConfirm: (status: Member['status']) => void
}) {
  const t = useLocaleText()
  return (
    <div className='flex items-center justify-end gap-1'>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => onStatusConfirm('suspended')}
      >
        <LocalizedText text={"\n        暂停\n      "} /></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='size-8'
            aria-label={`${t('更多操作')} ${member.user_name}`}
          >
            <MoreHorizontal className='size-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-32'>
          <DropdownMenuItem
            variant='destructive'
            onClick={() => onStatusConfirm('removed')}
          >
            <LocalizedText text={"\n            移除成员\n          "} /></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
