import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Search } from 'lucide-react'
import { listUsers, type GlobalUser } from '@/api/users'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth-store'
import { LocalizedText } from '@/components/localized-text'
import { useLocaleText } from '@/lib/i18n'

export function OwnerPicker({ value, onChange }: {
  value: GlobalUser | null
  onChange: (user: GlobalUser | null) => void
}) {
  const t = useLocaleText()
  const actorId = useAuthStore((state) => state.auth.user?.user_id ?? 'anonymous')
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])
  const users = useQuery({
    queryKey: ['synapse', actorId, 'global', 'owner-candidates', term],
    queryFn: () => listUsers({ page: 1, pageSize: 100, search: term || undefined }),
  })
  const candidates = users.data?.items.filter((user) => user.status === 'active') ?? []

  return (
    <div className='space-y-2'>
      <label htmlFor='tenant-owner-search' className='text-sm font-medium'><LocalizedText text={"首位所有者"} /></label>
      <div className='relative'>
        <Search className='pointer-events-none absolute start-3 top-2.5 size-4 text-muted-foreground' />
        <Input id='tenant-owner-search' value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder='搜索姓名、账号、邮箱或手机号' className='ps-9' autoComplete='off' />
      </div>
      {value ? <p className='text-sm'><LocalizedText text={"已选择："} /><span className='font-medium'>{value.nick_name || value.user_name}</span> <span className='text-muted-foreground'><LocalizedText text={"("} />{value.user_name}{value.email ? ` · ${value.email}` : <LocalizedText text={""} />}<LocalizedText text={")"} /></span></p> : null}
      <div className='max-h-40 overflow-y-auto rounded-md border' aria-label={t('可选账号')}>
        {users.isPending ? <p className='p-3 text-sm text-muted-foreground'><LocalizedText text={"正在查找账号…"} /></p>
          : users.isError ? <p className='p-3 text-sm text-destructive'><LocalizedText text={"账号加载失败，请重试。"} /></p>
          : candidates.length ? candidates.map((user) => (
            <button key={user.user_id} type='button' onClick={() => onChange(user)}
              className='flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-start text-sm last:border-0 hover:bg-muted'
              aria-pressed={value?.user_id === user.user_id}>
              <span><span className='font-medium'>{user.nick_name || user.user_name}</span><span className='block text-xs text-muted-foreground'>{user.user_name}{user.email ? ` · ${user.email}` : <LocalizedText text={""} />}</span></span>
              {value?.user_id === user.user_id ? <Check className='size-4 shrink-0 text-primary' /> : null}
            </button>
          )) : <p className='p-3 text-sm text-muted-foreground'><LocalizedText text={"没有找到启用的账号，请输入更具体的关键词。"} /></p>}
      </div>
      {users.data && users.data.total > 100 ? <p className='text-xs text-muted-foreground'><LocalizedText text={"结果较多，请输入姓名或账号缩小范围。"} /></p> : null}
    </div>
  )
}
