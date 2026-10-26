import { createFileRoute } from '@tanstack/react-router'
import { InvitationAcceptPageContent } from '@/features/invitation/invitation-accept-page'

export const Route = createFileRoute('/invite/accept')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  component: InvitationAcceptRoute,
})

function InvitationAcceptRoute() {
  return <InvitationAcceptPageContent token={Route.useSearch().token} />
}
