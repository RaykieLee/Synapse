import { Languages } from 'lucide-react'
import { useEffect } from 'react'
import { useLocale, setLocale } from '@/lib/i18n'
import { LocalizedText } from '@/components/localized-text'


export function LanguageSwitch() {
  const locale = useLocale()
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  return (
    <button
      type='button'
      className='inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium shadow-sm hover:bg-accent'
      aria-label={locale === 'zh-CN' ? "切换到 English" : "Switch to Chinese"}
      title={locale === 'zh-CN' ? "切换语言" : "Change language"}
      onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
    >
      <Languages className='size-3.5' aria-hidden='true' />
      {locale === 'zh-CN' ? <LocalizedText text={"English"} /> : <LocalizedText text={"Chinese"} />}
    </button>
  )
}
