import { describe, expect, it } from 'vitest'
import { getLocale, setLocale, syncLocaleFromStorage, translate } from './i18n'

describe('translate', () => {
  it('keeps authored Chinese labels unchanged in the Chinese locale', () => {
    expect(translate('选择工作区', 'zh-CN')).toBe('选择工作区')
    expect(translate('我的个人附件', 'zh-CN')).toBe('我的个人附件')
  })

  it('removes only unused template labels and integration statuses', () => {
    expect(translate('应用', 'en')).toBe('应用')
    expect(translate('聊天', 'en')).toBe('聊天')
    expect(translate('Apps', 'zh-CN')).toBe('Apps')
    expect(translate('Chats', 'zh-CN')).toBe('Chats')
    expect(translate('Connected', 'zh-CN')).toBe('Connected')
    expect(translate('Connect', 'zh-CN')).toBe('Connect')
  })

  it('preserves Help Center and Tasks translations used by active pages', () => {
    expect(translate('帮助中心', 'en')).toBe('Help Center')
    expect(translate('任务', 'en')).toBe('Tasks')
    expect(translate('Tasks', 'zh-CN')).toBe('任务')
  })

  it('localizes Workspace switcher and breadcrumb navigation labels', () => {
    expect(translate('搜索 Workspace 或租户…', 'zh-CN')).toBe(
      '搜索 Workspace 或租户…'
    )
    expect(translate('搜索 Workspace 或租户…', 'en')).toBe(
      'Search Workspaces or tenants…'
    )
    expect(translate('平台管理', 'en')).toBe('Platform administration')
    expect(translate('Workspace 工作台', 'en')).toBe('Workspace workbench')
  })

  it.each([
    ['zh-CN', 'en'],
    ['en', 'zh-CN'],
  ] as const)(
    'initializes the document language from stored locale %s before mount',
    (storedLocale, staleDocumentLanguage) => {
      setLocale(storedLocale === 'en' ? 'zh-CN' : 'en')
      window.localStorage.setItem(
        'synapse-locale',
        storedLocale === 'en' ? 'en' : 'zh-CN'
      )
      document.documentElement.lang = staleDocumentLanguage
      syncLocaleFromStorage()
      expect(getLocale()).toBe(storedLocale)
      expect(document.documentElement.lang).toBe(storedLocale)
    }
  )

  it('synchronizes the document language immediately when the locale changes', () => {
    document.documentElement.lang = 'zh-CN'
    setLocale('en')
    expect(document.documentElement.lang).toBe('en')
    document.documentElement.lang = 'en'
    setLocale('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
  })
})
