import { createFileRoute } from '@tanstack/react-router'
import { SetupPage } from '@/features/setup/page'

export const Route = createFileRoute('/_authenticated/setup')({
  component: SetupPage,
})
