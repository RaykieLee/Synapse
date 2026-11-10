import { useState } from 'react'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { ChevronDownIcon } from '@radix-ui/react-icons'
import { toast } from 'sonner'
import { fonts } from '@/config/fonts'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { useFont } from '@/context/font-provider'
import { useTheme } from '@/context/theme-provider'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { LocalizedNativeSelect } from '@/components/localized-native-select'
import { LocalizedText } from '@/components/localized-text'

const appearanceFormSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  font: z.enum(fonts),
})

type AppearanceFormValues = z.infer<typeof appearanceFormSchema>

const themeOptions = [
  { value: 'system', label: 'System', preview: 'bg-muted' },
  { value: 'light', label: 'Light', preview: 'bg-white' },
  { value: 'dark', label: 'Dark', preview: 'bg-slate-950' },
] as const

export function AppearanceForm({ onSaved }: { onSaved?: () => void }) {
  const { font, stageFont, applyFont } = useFont()
  const { theme, stageTheme, applyTheme } = useTheme()
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [failureDetails, setFailureDetails] = useState<string | null>(null)

  const form = useForm<AppearanceFormValues>({
    resolver: zodResolver(appearanceFormSchema),
    defaultValues: { theme, font },
  })

  function onSubmit(data: AppearanceFormValues) {
    setStatus('saving')
    setFailureDetails(null)
    let rollbackThemeCookie: (() => boolean) | undefined
    let rollbackFontCookie: (() => boolean) | undefined
    let failedPreference: 'theme' | 'font' | 'verification' = 'theme'
    let succeeded = false

    try {
      rollbackThemeCookie = stageTheme(data.theme).rollback
      failedPreference = 'font'
      rollbackFontCookie = stageFont(data.font).rollback
      failedPreference = 'verification'
      const persistedTheme = getCookie('vite-ui-theme')
      const persistedFont = getCookie('font')
      if (persistedTheme !== data.theme || persistedFont !== data.font) {
        throw new Error('Appearance cookie readback did not match the selected values.')
      }
      applyTheme(data.theme)
      applyFont(data.font)
      succeeded = true
    } catch (error) {
      let themeRollbackConfirmed: boolean | null = null
      let fontRollbackConfirmed: boolean | null = null
      if (rollbackFontCookie) {
        try {
          fontRollbackConfirmed = rollbackFontCookie()
        } catch {
          fontRollbackConfirmed = false
        }
      }
      if (rollbackThemeCookie) {
        try {
          themeRollbackConfirmed = rollbackThemeCookie()
        } catch {
          themeRollbackConfirmed = false
        }
      }
      const failureMetadata =
        error &&
        typeof error === 'object' &&
        'rollbackConfirmed' in error
          ? error as { rollbackConfirmed: boolean; writeAttempted?: boolean }
          : undefined
      const getCookieStatus = (
        rollbackConfirmed: boolean | null,
        preference: 'theme' | 'font'
      ) => {
        if (rollbackConfirmed === true) return 'restored to its previous value'
        if (rollbackConfirmed === false) return 'unconfirmed; it may retain the selected value'
        if (failedPreference === preference && failureMetadata) {
          if (failureMetadata.writeAttempted === false) {
            return 'unconfirmed; its previous value could not be read'
          }
          return failureMetadata.rollbackConfirmed
            ? 'restored to its previous value'
            : 'unconfirmed; it may retain the selected value'
        }
        return 'unchanged by this attempt'
      }
      const themeStatus = getCookieStatus(themeRollbackConfirmed, 'theme')
      const fontStatus = getCookieStatus(fontRollbackConfirmed, 'font')
      const partial = themeStatus.startsWith('unconfirmed') || fontStatus.startsWith('unconfirmed')
      setFailureDetails(
        `${partial ? 'Partial result' : 'Appearance was not applied'}: theme cookie ${themeStatus}; font cookie ${fontStatus}. Provider appearance was not applied.`
      )
    } finally {
      setStatus(succeeded ? 'idle' : 'error')
    }

    if (!succeeded) return
    toast.success('Appearance applied in this browser only.')
    onSaved?.()
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className='space-y-8'
        aria-busy={status === 'saving'}
      >
        <FormField
          control={form.control}
          name='font'
          render={({ field }) => (
            <FormItem>
              <FormLabel><LocalizedText text='Font' /></FormLabel>
              <div className='relative w-full sm:w-max'>
                <FormControl>
                  <LocalizedNativeSelect
                    className={cn(
                      buttonVariants({ variant: 'outline' }),
                      'h-11 w-full appearance-none pe-10 font-normal capitalize sm:w-50',
                      'dark:bg-background dark:hover:bg-background'
                    )}
                    {...field}
                  >
                    {fonts.map((fontOption) => (
                      <option key={fontOption} value={fontOption}>
                        {fontOption}
                      </option>
                    ))}
                  </LocalizedNativeSelect>
                </FormControl>
                <ChevronDownIcon className='pointer-events-none absolute inset-e-3 top-3 h-4 w-4 opacity-50' />
              </div>
              <FormDescription>
                <LocalizedText text='Set the font for this browser. It is not saved to your account or synced to other devices.' />
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='theme'
          render={({ field }) => (
            <FormItem>
              <FormLabel><LocalizedText text='Theme' /></FormLabel>
              <FormDescription>
                <LocalizedText text='Select the theme for this browser. It is not saved to your account or synced to other devices.' />
              </FormDescription>
              <FormMessage />
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className='grid max-w-md grid-cols-1 gap-4 pt-2 sm:grid-cols-3'
              >
                {themeOptions.map((option) => (
                  <FormItem key={option.value}>
                    <FormLabel className='[&:has([data-state=checked])>div]:border-primary'>
                      <FormControl>
                        <RadioGroupItem value={option.value} className='sr-only' />
                      </FormControl>
                      <div className='rounded-md border-2 border-muted p-1 hover:border-accent'>
                        <div className={cn('flex h-20 items-center justify-center rounded-sm p-2', option.preview)}>
                          <div className='w-full space-y-2 rounded-md border bg-background p-2 shadow-xs'>
                            <div className='h-2 w-20 rounded-lg bg-muted-foreground/40' />
                            <div className='h-2 w-3/4 rounded-lg bg-muted-foreground/40' />
                          </div>
                        </div>
                      </div>
                      <span className='block w-full p-2 text-center font-normal'>
                        <LocalizedText text={option.label} />
                      </span>
                    </FormLabel>
                  </FormItem>
                ))}
              </RadioGroup>
            </FormItem>
          )}
        />
        {status === 'error' ? (
          <div role='alert' className='space-y-1 text-sm text-destructive'>
            <p><LocalizedText text='The browser could not confirm the appearance cookie. Your changes were not reported as applied.' /></p>
            {failureDetails ? <p>{failureDetails}</p> : null}
          </div>
        ) : null}
        <Button type='submit' disabled={status === 'saving'}>
          <LocalizedText text={status === 'saving' ? 'Applying…' : 'Apply for this browser'} />
        </Button>
      </form>
    </Form>
  )
}
