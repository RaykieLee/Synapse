import * as React from 'react'
import { translate, useLocale } from '@/lib/i18n'

/** Native select with localized authored accessibility labels. Option values remain untouched. */
export function LocalizedNativeSelect({ ...props }: React.ComponentProps<'select'>) {
  const locale = useLocale()
  return (
    <select
      {...props}
      aria-label={props['aria-label'] ? translate(props['aria-label'], locale) : undefined}
      title={props.title ? translate(props.title, locale) : undefined}
    />
  )
}
