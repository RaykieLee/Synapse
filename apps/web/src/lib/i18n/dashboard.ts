import {
  defineTranslationModule,
  fromChineseToEnglish,
  fromEnglishToChinese,
} from './catalog'

const dashboardEnglishToChineseMessages = [
  [0, 'Workspace summary', '工作区摘要'],
  [1, 'Workspace overview', '工作区概览'],
  [2, 'Workspace activity', '工作区动态'],
  [3, 'Workspace analytics', '工作区分析'],
  [4, 'Activity', '活动'],
  [5, 'Agents', '智能体'],
  [6, 'Resources', '资源'],
  [7, 'Data sources', '数据来源'],
  [8, 'Resource categories', '资源分类'],
  [9, "Workspace data isn't connected yet.", '工作区数据尚未接入。'],
  [
    10,
    'No workspace data source is configured, so metrics are unavailable.',
    '尚未配置工作区数据源，因此指标暂不可用。',
  ],
  [11, "Workspace overview data isn't connected yet.", '工作区概览数据尚未接入。'],
  [
    12,
    'No workspace data source is configured, so this overview is unavailable.',
    '尚未配置工作区数据源，因此概览暂不可用。',
  ],
  [13, "Workspace activity data isn't connected yet.", '工作区动态数据尚未接入。'],
  [
    14,
    'No workspace data source is configured, so activity history is unavailable.',
    '尚未配置工作区数据源，因此动态记录暂不可用。',
  ],
  [15, "Analytics data isn't connected yet.", '分析数据尚未接入。'],
  [
    16,
    'No analytics data source is configured, so metrics are unavailable.',
    '尚未配置分析数据源，因此指标暂不可用。',
  ],
  [
    17,
    'No analytics data source is configured, so charts are unavailable.',
    '尚未配置分析数据源，因此图表暂不可用。',
  ],
  [
    18,
    'No analytics data source is configured, so charts and breakdowns are unavailable.',
    '尚未配置分析数据源，因此图表和分类数据暂不可用。',
  ],
] as const

const dashboardChineseToEnglishMessages = dashboardEnglishToChineseMessages
  .filter(([, english]) => english !== 'Agents')
  .map(([entryOrder, english, chinese]) => [
    entryOrder,
    chinese,
    english,
  ] as const)

export const dashboardTranslationModule = defineTranslationModule(
  'dashboard',
  [
    ...fromEnglishToChinese(
      'dashboardEnglishToChinese',
      2,
      1,
      dashboardEnglishToChineseMessages,
    ),
    ...fromChineseToEnglish(
      'dashboardChineseToEnglish',
      6,
      1,
      dashboardChineseToEnglishMessages,
    ),
  ],
)
