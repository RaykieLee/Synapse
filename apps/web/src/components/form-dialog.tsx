import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LocalizedText } from '@/components/localized-text'
import { useLocaleText } from '@/lib/i18n'

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  error,
  children,
  onSubmit,
  onCancel,
  submitLabel,
  cancelLabel = '取消',
  pending = false,
  disabled = false,
  contentClassName,
  formClassName,
  formAriaLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  error?: ReactNode
  children: ReactNode
  onSubmit: () => void
  onCancel: () => void
  submitLabel: ReactNode
  cancelLabel?: string
  pending?: boolean
  disabled?: boolean
  contentClassName?: string
  formClassName?: string
  formAriaLabel: string
}) {
  const t = useLocaleText()
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        className={`max-h-[min(85vh,44rem)] overflow-y-auto sm:max-w-3xl ${contentClassName ?? ''}`}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {error && (
          <div role='alert' className='rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'>
            {error}
          </div>
        )}
        <form
          aria-label={t(formAriaLabel)}
          className={`space-y-4 ${formClassName ?? ''}`}
          onSubmit={(event) => {
            event.preventDefault()
            if (!pending && !disabled) onSubmit()
          }}
        >
          {children}
          <DialogFooter>
            <Button type='button' variant='outline' disabled={pending} onClick={onCancel}>
              <LocalizedText text={cancelLabel} />
            </Button>
            <Button type='submit' disabled={pending || disabled}>
              {pending ? <LocalizedText text='保存中…' /> : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
