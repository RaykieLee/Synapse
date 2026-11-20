import { DashboardEmptyState } from './empty-state'

export function AnalyticsChart() {
  return (
    <DashboardEmptyState
      className='min-h-[300px]'
      title="Analytics data isn't connected yet."
      description='No analytics data source is configured, so charts are unavailable.'
    />
  )
}
