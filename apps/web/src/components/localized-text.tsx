import { useLocale, translate } from '@/lib/i18n'

/** Localizes only authored, static JSX copy; dynamic React data stays untouched. */
export function LocalizedText({ text }: { text: string }) {
  const locale = useLocale()
  return <>{translate(text, locale)}</>
}
