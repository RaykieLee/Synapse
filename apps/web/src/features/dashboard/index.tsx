import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
import { Bot, Building2, ListTodo, Users } from 'lucide-react'
import { Analytics } from './components/analytics'
import { Overview } from './components/overview'
import { WorkspaceActivity } from './components/workspace-activity'
import { LocalizedText } from '@/components/localized-text'

const workspaceMetrics = [
  { title: 'Workspace', Icon: Building2 },
  { title: 'Members', Icon: Users },
  { title: 'Agents', Icon: Bot },
  { title: 'Tasks', Icon: ListTodo },
]

export function Dashboard() {
  return (
    <>
      <Main>
        <div className='mb-2 flex items-center space-y-2'>
          <h1 className='text-2xl font-bold tracking-tight'><LocalizedText text={"Dashboard"} /></h1>
        </div>
        <Tabs
          orientation='horizontal'
          defaultValue='overview'
          className='space-y-4'
        >
          <div className='w-full overflow-x-auto pb-2'>
            <TabsList>
              <TabsTrigger value='overview'><LocalizedText text={"Overview"} /></TabsTrigger>
              <TabsTrigger value='analytics'><LocalizedText text={"Analytics"} /></TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value='overview' className='space-y-4'>
            <h2 className='text-lg font-semibold tracking-tight'>
              <LocalizedText text='Workspace summary' />
            </h2>
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              {workspaceMetrics.map(({ title, Icon }) => (
                <Card key={title}>
                  <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                    <h3 className='text-sm leading-none font-medium'>
                      <LocalizedText text={title} />
                    </h3>
                    <Icon aria-hidden='true' className='h-4 w-4 text-muted-foreground' />
                  </CardHeader>
                  <CardContent>
                    <div className='text-2xl font-bold'>—</div>
                    <p className='text-xs text-muted-foreground'>
                      <LocalizedText text="Workspace data isn't connected yet." />
                    </p>
                    <p className='text-xs text-muted-foreground'>
                      <LocalizedText text='No workspace data source is configured, so metrics are unavailable.' />
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className='grid grid-cols-1 gap-4 lg:grid-cols-7'>
              <Card className='col-span-1 lg:col-span-4'>
                <CardHeader>
                  <h2 className='text-base leading-none font-semibold'>
                    <LocalizedText text='Workspace overview' />
                  </h2>
                </CardHeader>
                <CardContent className='ps-2'>
                  <Overview />
                </CardContent>
              </Card>
              <Card className='col-span-1 lg:col-span-3'>
                <CardHeader>
                  <h2 className='text-base leading-none font-semibold'>
                    <LocalizedText text='Workspace activity' />
                  </h2>
                </CardHeader>
                <CardContent>
                  <WorkspaceActivity />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          <TabsContent value='analytics' className='space-y-4'>
            <Analytics />
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
