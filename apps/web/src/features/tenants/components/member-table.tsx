import { MoreHorizontal, RotateCcw } from 'lucide-react'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
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
  const t = useLocaleText()
  const columnCount = canManage ? 6 : 5

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
                    <details className='text-xs text-muted-foreground'>
                      <summary className='w-fit cursor-pointer'><LocalizedText text={"技术信息"} /></summary>
                      <div className='mt-1 flex flex-wrap items-center gap-2'>
                        <code>账号 ID {member.user_id}</code>
                        <button type='button' className='underline' onClick={() => navigator.clipboard.writeText(member.user_id)}><LocalizedText text={"复制"} /></button>
                      </div>
                    </details>
                  </div>
                </TableCell>
                <TableCell>
                  {canManage && member.tenant_role !== 'owner' ? (
                    <LocalizedNativeSelect
                      aria-label={`${member.user_name} ${t('角色')}`}
                      className='h-8 rounded-md border bg-background px-2 text-sm shadow-xs'
                      value={member.tenant_role}
                      onChange={(event) =>
                        onRoleChange(member, event.target.value as MemberRole)
                      }
                    >
                      <option value='member'><LocalizedText text={"成员"} /></option>
                      <option value='admin'><LocalizedText text={"管理员"} /></option>
                      {currentRole === 'owner' ? (
                        <option value='owner'><LocalizedText text={"所有者"} /></option>
                      ) : null}
                    </LocalizedNativeSelect>
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
  const t = useLocaleText()
  return (
    <div className='flex items-center justify-end gap-1'>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => onStatusChange(member, 'suspended')}
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
            onClick={() => onRemove(member)}
          >
            <LocalizedText text={"\n            移除成员\n          "} /></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
