import { type Task } from './schema'

// Deterministic sample rows keep the Tasks template usable without implying live business data.
export const tasks: Task[] = [
  {
    id: 'TASK-001',
    title: 'Sample task 001',
    status: 'todo',
    label: 'feature',
    priority: 'medium',
  },
  {
    id: 'TASK-002',
    title: 'Sample task 002',
    status: 'in progress',
    label: 'documentation',
    priority: 'low',
  },
  {
    id: 'TASK-003',
    title: 'Sample task 003',
    status: 'done',
    label: 'bug',
    priority: 'high',
  },
  {
    id: 'TASK-004',
    title: 'Sample task 004',
    status: 'backlog',
    label: 'documentation',
    priority: 'medium',
  },
  {
    id: 'TASK-005',
    title: 'Sample task 005',
    status: 'canceled',
    label: 'bug',
    priority: 'low',
  },
]
