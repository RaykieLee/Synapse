import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { translate, useLocale } from '@/lib/i18n'


type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  disabled?: boolean
  desc: React.JSX.Element | string
  cancelBtnText?: string
  confirmText?: React.ReactNode
  destructive?: boolean
  isLoading?: boolean
  className?: string
  children?: React.ReactNode
} & (
  | { form: string; handleConfirm?: undefined }
  | { form?: undefined; handleConfirm: () => void }
)

export function ConfirmDialog(props: ConfirmDialogProps) {
  const locale = useLocale()
  const {
    title,
    desc,
    children,
    className,
    confirmText,
    cancelBtnText,
    destructive,
    isLoading,
    disabled = false,
    form,
    handleConfirm,
    ...actions
  } = props
  return (
    <AlertDialog {...actions}>
      <AlertDialogContent className={cn(className && className)}>
        <AlertDialogHeader className='text-start'>
          <AlertDialogTitle>{typeof title === 'string' ? translate(title, locale) : title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{typeof desc === 'string' ? translate(desc, locale) : desc}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>
            {cancelBtnText ? translate(cancelBtnText, locale) : translate('Cancel', locale)}
          </AlertDialogCancel>
          <Button
            type={form ? "submit" : "button"}
            form={form}
            onClick={handleConfirm}
            variant={destructive ? "destructive" : "default"}
            disabled={disabled || isLoading}
          >
            {typeof confirmText === 'string' ? translate(confirmText, locale) : confirmText ?? translate('Continue', locale)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
