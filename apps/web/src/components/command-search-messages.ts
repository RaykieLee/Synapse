import type { Locale } from '@/lib/i18n'

const messages = {
  'quick-navigation': { 'zh-CN': '快速导航', en: 'Quick navigation' },
  'search-placeholder': {
    'zh-CN': '搜索页面或工作空间…',
    en: 'Search pages or workspaces…',
  },
  'search-description': {
    'zh-CN': '仅搜索你有权访问的导航，不搜索内容。',
    en: 'Searches accessible navigation—not content.',
  },
  'global-scope': { 'zh-CN': '全局导航', en: 'Global navigation' },
  'tenant-scope': {
    'zh-CN': '当前租户：{tenant}',
    en: 'Current tenant: {tenant}',
  },
  'workspace-scope': {
    'zh-CN': '当前空间：{workspace} · {tenant}',
    en: 'Current workspace: {workspace} · {tenant}',
  },
  navigation: { 'zh-CN': '导航目的地', en: 'Navigation' },
  'workspace-switch': { 'zh-CN': '切换工作空间', en: 'Switch workspace' },
  commands: { 'zh-CN': '命令', en: 'Commands' },
  theme: { 'zh-CN': '主题', en: 'Theme' },
  language: { 'zh-CN': '语言', en: 'Language' },
  light: { 'zh-CN': '浅色', en: 'Light' },
  dark: { 'zh-CN': '深色', en: 'Dark' },
  system: { 'zh-CN': '系统', en: 'System' },
  'switch-to-chinese': { 'zh-CN': '切换到简体中文', en: 'Switch to Chinese' },
  'switch-to-english': { 'zh-CN': '切换到英文', en: 'Switch to English' },
  'verify-account': {
    'zh-CN': '正在确认当前账号…',
    en: 'Verifying the current account…',
  },
  'verify-tenant': {
    'zh-CN': '正在确认当前租户…',
    en: 'Verifying the current tenant…',
  },
  'verify-workspace': {
    'zh-CN': '正在确认当前空间…',
    en: 'Verifying the current workspace…',
  },
  'context-unavailable': {
    'zh-CN': '当前导航范围暂时无法确认。',
    en: 'The current navigation scope could not be confirmed.',
  },
  'tenant-unavailable': {
    'zh-CN': '当前租户无法在已授权目录中确认。',
    en: 'The current tenant is not confirmed in the accessible directory.',
  },
  'workspace-unavailable': {
    'zh-CN': '当前空间无法在已授权目录中确认。',
    en: 'The current workspace is not confirmed in the accessible directory.',
  },
  'loading-directory': {
    'zh-CN': '正在加载可访问空间目录…',
    en: 'Loading accessible workspace directory…',
  },
  'loading-navigation': {
    'zh-CN': '正在加载空间导航…',
    en: 'Loading workspace navigation…',
  },
  'directory-error': {
    'zh-CN': '空间目录暂时无法加载，已确认的导航仍可使用。',
    en: 'The workspace directory is temporarily unavailable; confirmed navigation remains available.',
  },
  'navigation-error': {
    'zh-CN': '空间导航暂时无法加载，固定导航仍可使用。',
    en: 'Workspace navigation is temporarily unavailable; fixed navigation remains available.',
  },
  'scope-mismatch': {
    'zh-CN': '空间导航与当前已确认范围不匹配，已隐藏动态结果。',
    en: 'Workspace navigation does not match the confirmed scope; dynamic results are hidden.',
  },
  'no-results': {
    'zh-CN': '没有匹配的可访问页面或空间。',
    en: 'No accessible pages or workspaces match.',
  },
  'empty-workspaces': {
    'zh-CN': '当前账号还没有可访问的工作空间。',
    en: 'No workspaces are available to this account.',
  },
  'empty-navigation': {
    'zh-CN': '当前空间没有其他导航项。',
    en: 'No additional navigation is available in this workspace.',
  },
  'switch-target-unavailable': {
    'zh-CN': '该空间不再位于已确认的可访问目录中；请重试目录加载。',
    en: 'This workspace is no longer in the confirmed directory. Retry loading the directory.',
  },
  retry: { 'zh-CN': '重试', en: 'Retry' },
  'clear-search': { 'zh-CN': '清除搜索', en: 'Clear search' },
  'open-external': { 'zh-CN': '在新标签页打开', en: 'Opens in a new tab' },
  current: { 'zh-CN': '当前页面', en: 'Current page' },
} satisfies Record<string, Record<Locale, string>>

export type CommandSearchMessage = keyof typeof messages

export function commandSearchMessage(
  locale: Locale,
  key: CommandSearchMessage,
  values: Record<string, string> = {}
) {
  return messages[key][locale].replace(
    /\{(\w+)\}/g,
    (_match, name: string) => values[name] ?? '{' + name + '}'
  )
}
