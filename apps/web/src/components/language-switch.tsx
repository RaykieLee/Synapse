import { Languages } from 'lucide-react'
import { useLayoutEffect } from 'react'
import { useLocale, setLocale, syncLocaleFromStorage } from '@/lib/i18n'
import { Button } from '@/components/ui/button'


export function LanguageSwitch({ className }: { className?: string }) {
  const locale = useLocale()
  useLayoutEffect(() => { syncLocaleFromStorage() }, [syncLocaleFromStorage])
  return (
    <Button
      type='button'
      variant='ghost'
      size='icon'
      className={className}
      aria-label={locale === 'zh-CN' ? "切换到 English" : "Switch to Chinese"}
      title={locale === 'zh-CN' ? "切换语言" : "Change language"}
      onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
    >
      <Languages className='size-[1.2rem]' aria-hidden='true' />
    </Button>
  )
}
