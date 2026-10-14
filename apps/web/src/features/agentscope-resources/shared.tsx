import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LocalizedText } from '@/components/localized-text'

export function ResourceError({ error }: { error: unknown }) {
  return (
    <p role='alert' className='rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'>
      {error instanceof Error ? error.message : '请求失败，请稍后重试。'}
    </p>
  )
}

export function ResourceLoading() {
  return <p className='py-8 text-center text-sm text-muted-foreground'><LocalizedText text='正在加载…' /></p>
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>{children}</div>
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className='max-w-sm'
    />
  )
}

export function PageButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return <Button type='button' variant='outline' size='sm' disabled={disabled} onClick={onClick}>{children}</Button>
}
