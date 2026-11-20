import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatMessage, getLocale, setLocale, t, translate } from './i18n'
import {
  translationCatalogModules,
  translationLookupChains,
  validateTranslationCatalog,
} from './i18n/index'

const localeStorageKey = 'synapse-locale'

beforeEach(() => {
  window.localStorage.removeItem(localeStorageKey)
  setLocale('zh-CN')
})

afterEach(() => {
  setLocale('zh-CN')
  window.localStorage.removeItem(localeStorageKey)
})

describe('translation catalog registration', () => {
  it('statically registers every domain module with complete bilingual keys', () => {
    expect(translationCatalogModules.map(({ id }) => id)).toEqual([
      'auth',
      'attachments',
      'common',
      'dashboard',
      'legacy',
      'navigation',
      'settings',
      'tenants',
      'workspaces',
    ])
    expect(translationLookupChains.en.map(({ chainOrder }) => chainOrder)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ])
    expect(
      translationLookupChains['zh-CN'].map(({ chainOrder }) => chainOrder),
    ).toEqual([0, 1, 2, 3])
    expect(validateTranslationCatalog(translationCatalogModules)).toEqual({
      duplicateModuleIds: [],
      duplicateEntryKeys: [],
      missingLocaleKeys: [],
    })
  })

  it('reports a missing locale key through the catalog guard', () => {
    expect(
      validateTranslationCatalog([
        {
          id: 'example',
          entries: [{ key: 'greeting', locales: { 'zh-CN': '你好' } }],
        }],
      ).missingLocaleKeys,
    ).toEqual(['example.greeting.en'])
  })

  it('restores every Dashboard lookup without changing legacy precedence', () => {
    const dashboardMessages = [
      ['Workspace summary', '工作区摘要'],
      ['Workspace overview', '工作区概览'],
      ['Workspace activity', '工作区动态'],
      ['Workspace analytics', '工作区分析'],
      ['Activity', '活动'],
      ['Agents', '智能体'],
      ['Resources', '资源'],
      ['Data sources', '数据来源'],
      ['Resource categories', '资源分类'],
      ["Workspace data isn't connected yet.", '工作区数据尚未接入。'],
      [
        'No workspace data source is configured, so metrics are unavailable.',
        '尚未配置工作区数据源，因此指标暂不可用。',
      ],
      ["Workspace overview data isn't connected yet.", '工作区概览数据尚未接入。'],
      [
        'No workspace data source is configured, so this overview is unavailable.',
        '尚未配置工作区数据源，因此概览暂不可用。',
      ],
      ["Workspace activity data isn't connected yet.", '工作区动态数据尚未接入。'],
      [
        'No workspace data source is configured, so activity history is unavailable.',
        '尚未配置工作区数据源，因此动态记录暂不可用。',
      ],
      ["Analytics data isn't connected yet.", '分析数据尚未接入。'],
      [
        'No analytics data source is configured, so metrics are unavailable.',
        '尚未配置分析数据源，因此指标暂不可用。',
      ],
      [
        'No analytics data source is configured, so charts are unavailable.',
        '尚未配置分析数据源，因此图表暂不可用。',
      ],
      [
        'No analytics data source is configured, so charts and breakdowns are unavailable.',
        '尚未配置分析数据源，因此图表和分类数据暂不可用。',
      ],
    ] as const
    const dashboardModule = translationCatalogModules.find(
      ({ id }) => id === 'dashboard',
    )

    expect(
      dashboardModule?.entries.flatMap(({ lookups }) => lookups),
    ).toHaveLength(37)

    for (const [english, chinese] of dashboardMessages) {
      expect(translate(english, 'zh-CN')).toBe(chinese)
      expect(translate(chinese, 'en')).toBe(
        english === 'Agents' ? 'Agent' : english,
      )
    }
  })
})

describe('locale switching and translation lookup', () => {
  it('switches synchronously, persists the locale, and keeps the t alias', () => {
    expect(getLocale()).toBe('zh-CN')
    setLocale('en')
    expect(getLocale()).toBe('en')
    expect(window.localStorage.getItem(localeStorageKey)).toBe('en')
    expect(t('保存')).toBe('Save')

    setLocale('zh-CN')
    expect(getLocale()).toBe('zh-CN')
    expect(window.localStorage.getItem(localeStorageKey)).toBe('zh-CN')
    expect(t('保存')).toBe('保存')
  })

  it('keeps existing domain translations in both directions', () => {
    expect(translate('登录工作空间', 'en')).toBe('Sign in to workspace')
    expect(translate('当前没有可访问的启用租户', 'en')).toBe(
      'No active tenants are accessible to you',
    )
    expect(translate('创建团队草稿', 'en')).toBe('Create a team draft')
    expect(translate('删除附件', 'en')).toBe('Delete attachment')
    expect(translate('Delete attachment', 'zh-CN')).toBe('删除附件')
    expect(translate('Dashboard', 'zh-CN')).toBe('仪表盘')
  })

  it('preserves the original dictionary and merge fallback priority', () => {
    expect(translate('成员', 'en')).toBe('Members')
    expect(translate('错误页面', 'en')).toBe('Errors')
    expect(translate('团队成员', 'zh-CN')).toBe('团队成员')
  })

  it('returns unknown keys unchanged and retains missing format placeholders', () => {
    const unknown = '  未登记的词条  '
    expect(translate(unknown, 'en')).toBe(unknown)
    expect(translate(unknown, 'zh-CN')).toBe(unknown)
    expect(formatMessage('确定归档“{name}”吗？', {}, 'en')).toBe(
      'Archive “{name}”?',
    )
  })
})
