import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card'
import { LocalizedText } from '@/components/localized-text'
import { AnalyticsChart } from './analytics-chart'
import { DashboardEmptyState } from './empty-state'

const analyticsMetrics = ['Activity', 'Members', 'Resources', 'Tasks']
const analyticsBreakdowns = ['Data sources', 'Resource categories']

export function Analytics() {
  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <h2 className='text-base leading-none font-semibold'>
            <LocalizedText text='Workspace analytics' />
          </h2>
        </CardHeader>
        <CardContent className='px-6'>
          <AnalyticsChart />
        </CardContent>
      </Card>

      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        {analyticsMetrics.map((metric) => (
          <Card key={metric}>
            <CardHeader className='pb-2'>
              <h3 className='text-sm leading-none font-medium'>
                <LocalizedText text={metric} />
              </h3>
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>—</div>
              <p className='text-xs text-muted-foreground'>
                <LocalizedText text="Analytics data isn't connected yet." />
              </p>
              <p className='text-xs text-muted-foreground'>
                <LocalizedText text='No analytics data source is configured, so metrics are unavailable.' />
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-7'>
        {analyticsBreakdowns.map((breakdown, index) => (
          <Card
            key={breakdown}
            className={
              index === 0
                ? 'col-span-1 lg:col-span-4'
                : 'col-span-1 lg:col-span-3'
            }
          >
            <CardHeader>
              <h3 className='text-base leading-none font-semibold'>
                <LocalizedText text={breakdown} />
              </h3>
            </CardHeader>
            <CardContent>
              <DashboardEmptyState
                className='min-h-[160px]'
                title="Analytics data isn't connected yet."
                description='No analytics data source is configured, so charts and breakdowns are unavailable.'
                level={4}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
