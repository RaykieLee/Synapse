import { useLocale } from '@/lib/i18n'

const englishMessages: Record<string, string> = {
  '租户名称暂不可用': 'Tenant name temporarily unavailable',
  '无法加载租户目录': 'Could not load the tenant directory',
  '租户和 Workspace 目录均无法加载':
    'Neither the tenant nor the Workspace directory could be loaded',
  '仅展示成功加载的目录数据；失败的目录不作为权限或“无 Workspace”依据。请重试失败项。':
    'Only successfully loaded directory data is shown. A failed directory is not evidence of permissions or that no Workspaces exist. Retry the failed directory.',
}

export function useWorkbenchMessage(text: string) {
  const locale = useLocale()
  return locale === 'en' ? (englishMessages[text] ?? text) : text
}
