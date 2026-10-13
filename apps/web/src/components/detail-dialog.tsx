import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function DetailDialog({
  trigger,
  title,
  description,
  children,
  triggerClassName,
  contentClassName,
}: {
  trigger: ReactNode
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  triggerClassName?: string
  contentClassName?: string
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className={triggerClassName}
        >
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
