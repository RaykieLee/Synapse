import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { LocalizedText } from '@/components/localized-text'

export const panelClass =
  'rounded-xl border bg-card text-card-foreground shadow-sm'

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        className
      )}
    >
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold tracking-tight'>{title}</h1>
        <p className='max-w-3xl text-sm leading-relaxed text-muted-foreground'>
          {description}
        </p>
      </div>
      {actions ? (
        <div className='flex flex-wrap items-center gap-2'>{actions}</div>
      ) : null}
    </header>
  )
}
export function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role='alert'
      className='rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'
    >
      {message}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  className,
}: {
  title: string
  description?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex h-28 flex-col items-center justify-center gap-1 rounded-lg bg-muted/20 text-center',
        className
      )}
    >
      <p className='text-sm font-medium'><LocalizedText text={title} /></p>
      {description ? (
        <p className='text-xs text-muted-foreground'><LocalizedText text={description} /></p>
      ) : null}
    </div>
  )
}
