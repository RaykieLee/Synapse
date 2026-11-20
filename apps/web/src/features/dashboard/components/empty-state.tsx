import { LocalizedText } from '@/components/localized-text'
import { cn } from '@/lib/utils'

export function DashboardEmptyState({
  title,
  description,
  className,
  level = 3,
}: {
  title: string
  description: string
  className?: string
  level?: 2 | 3 | 4
}) {
  return (
    <div
      role='status'
      className={cn(
        'flex flex-col items-center justify-center gap-1 px-4 py-6 text-center text-sm text-muted-foreground',
        className
      )}
    >
      <p
        className='font-medium text-foreground'
        role='heading'
        aria-level={level}
      >
        <LocalizedText text={title} />
      </p>
      <p>
        <LocalizedText text={description} />
      </p>
    </div>
  )
}
