
import { LocalizedText } from '@/components/localized-text'

export function SkipToMain() {
  return (
    <a
      className={`fixed inset-s-44 z-999 -translate-y-52 bg-primary px-4 py-2 text-sm font-medium whitespace-nowrap text-primary-foreground opacity-95 shadow-sm transition hover:bg-primary/90 focus:translate-y-3 focus:transform focus-visible:ring-1 focus-visible:ring-ring`}
      href='#content'
    >
      <LocalizedText text={"\n      Skip to Main\n    "} /></a>
  )
}
