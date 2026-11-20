import { DashboardEmptyState } from './empty-state'

export function WorkspaceActivity() {
  return (
    <DashboardEmptyState
      className='min-h-[300px]'
      title="Workspace activity data isn't connected yet."
      description='No workspace data source is configured, so activity history is unavailable.'
    />
  )
}
