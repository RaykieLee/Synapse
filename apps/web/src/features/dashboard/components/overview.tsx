import { DashboardEmptyState } from './empty-state'

export function Overview() {
  return (
    <DashboardEmptyState
      className='min-h-[350px]'
      title="Workspace overview data isn't connected yet."
      description='No workspace data source is configured, so this overview is unavailable.'
    />
  )
}
