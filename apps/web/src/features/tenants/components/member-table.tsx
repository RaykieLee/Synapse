import { useState } from 'react'
import { MoreHorizontal, RotateCcw, UserPlus } from 'lucide-react'
import type { Member, MemberRole } from '@/api/tenants'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
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

const statusStyles: Record<Member['status'], string> = {
  active:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  suspended:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  removed:
    'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
}

export function AddMemberDialog({
  pending,
  onAdd,
}: {
  pending: boolean
  onAdd: (userId: string, role: MemberRole) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size='sm' onClick={() => setOpen(true)}>
        <UserPlus className='size-4' /> 添加已有成员
      </Button>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>添加租户成员</DialogTitle>
          <DialogDescription>
            直接添加已有全局账号，不自动授予 Workspace 业务数据访问权。
          </DialogDescription>
        </DialogHeader>
        <form
          className='space-y-4'
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            onAdd(
              String(form.get('user_id')),
              String(form.get('role')) as MemberRole
            )
            event.currentTarget.reset()
            setOpen(false)
          }}
        >
          <div className='space-y-2'>
            <Label htmlFor='member-user-id'>全局账号 ID</Label>
            <Input
              id='member-user-id'
              name='user_id'
              required
              inputMode='numeric'
              pattern='[0-9]+'
              placeholder='1'
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='member-role'>租户角色</Label>
            <select
              id='member-role'
              name='role'
              className='h-9 w-full rounded-md border bg-background px-3 text-sm shadow-xs'
            >
              <option value='member'>成员</option>
              <option value='admin'>管理员</option>
            </select>
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button type='submit' disabled={pending}>
              添加成员
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
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
  renderCustomRole,
}: {
  members: Member[]
  canManage: boolean
  currentRole: 'owner' | 'admin' | 'member' | null
  loading: boolean
  onRoleChange: (member: Member, role: MemberRole) => void
  onStatusChange: (member: Member, status: Member['status']) => void
  onRemove: (member: Member) => void
  onReactivate: (member: Member) => void
  renderCustomRole: (member: Member) => React.ReactNode
}) {
  const columnCount = canManage ? 6 : 5

  return (
    <div className='overflow-hidden border-t'>
      <Table>
        <TableHeader>
          <TableRow className='bg-muted/35 hover:bg-muted/35'>
            <TableHead className='h-11 ps-4'>成员</TableHead>
            <TableHead className='hidden md:table-cell'>账号 ID</TableHead>
            <TableHead>角色</TableHead>
            <TableHead>自定义角色</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className='hidden xl:table-cell'>加入时间</TableHead>
            {canManage ? (
              <TableHead className='w-20 pe-4 text-end'>管理</TableHead>
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
                  </div>
                </TableCell>
                <TableCell className='hidden font-mono text-xs text-muted-foreground md:table-cell'>
                  {member.user_id}
                </TableCell>
                <TableCell>
                  {canManage && member.tenant_role !== 'owner' ? (
                    <select
                      aria-label={`${member.user_name}角色`}
                      className='h-8 rounded-md border bg-background px-2 text-sm shadow-xs'
                      value={member.tenant_role}
                      onChange={(event) =>
                        onRoleChange(member, event.target.value as MemberRole)
                      }
                    >
                      <option value='member'>成员</option>
                      <option value='admin'>管理员</option>
                      {currentRole === 'owner' ? (
                        <option value='owner'>所有者</option>
                      ) : null}
                    </select>
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
                        受保护
                      </span>
                    ) : member.status === 'active' ? (
                      <MemberRowActions
                        member={member}
                        onStatusChange={onStatusChange}
                        onRemove={onRemove}
                      />
                    ) : member.status === 'removed' ||
                      member.status === 'suspended' ? (
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => onReactivate(member)}
                      >
                        <RotateCcw className='size-4' /> 重新加入
                      </Button>
                    ) : (
                      <span className='text-xs text-muted-foreground'>—</span>
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
    </div>
  )
}

function MemberRowActions({
  member,
  onStatusChange,
  onRemove,
}: {
  member: Member
  onStatusChange: (member: Member, status: Member['status']) => void
  onRemove: (member: Member) => void
}) {
  return (
    <div className='flex items-center justify-end gap-1'>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => onStatusChange(member, 'suspended')}
      >
        暂停
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='size-8'
            aria-label={`更多操作 ${member.user_name}`}
          >
            <MoreHorizontal className='size-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-32'>
          <DropdownMenuItem
            variant='destructive'
            onClick={() => onRemove(member)}
          >
            移除成员
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
