import { Main } from '@/components/layout/main'
import { TasksDialogs } from './components/tasks-dialogs'
import { TasksPrimaryButtons } from './components/tasks-primary-buttons'
import { TasksProvider } from './components/tasks-provider'
import { TasksTable } from './components/tasks-table'
import { tasks } from './data/tasks'
import { LocalizedText } from '@/components/localized-text'

export function Tasks() {
  return (
    <TasksProvider>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'><LocalizedText text={"Tasks"} /></h2>
            <p className='text-muted-foreground'>
              <LocalizedText text={"\n              Here&apos;s a list of your tasks for this month!\n            "} /></p>
          </div>
          <TasksPrimaryButtons />
        </div>
        <TasksTable data={tasks} />
      </Main>

      <TasksDialogs />
    </TasksProvider>
  )
}
