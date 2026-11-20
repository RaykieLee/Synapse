import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceAttachments } from '@/features/workspaces/attachments-page'

const attachmentSearchSchema = z.object({
  scope_kind: z.enum(['workspace', 'personal']).optional().catch('workspace'),
  page: z.number().int().min(1).optional().catch(1),
  page_size: z.number().int().min(1).max(100).optional().catch(20),
})

export const Route = createFileRoute('/_authenticated/w/$workspaceId/attachments')({
  validateSearch: attachmentSearchSchema,
  component: WorkspaceAttachments,
})
