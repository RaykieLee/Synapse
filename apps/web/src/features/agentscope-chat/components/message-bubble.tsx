import { Paperclip } from 'lucide-react'
import { LocalizedText } from '@/components/localized-text'

export type ChatBlock = {
  type: string
  id?: string
  text?: string
  input?: string
  output?:
    | string
    | Array<{
        type?: string
        text?: string
        name?: string
        media_type?: string
      }>
  state?: string
  suggested_rules?: unknown[]
  created_at?: string
  finished_at?: string | null
  name?: string | null
  source?: { type?: string; media_type?: string; url?: string }
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  name: string
  content: ChatBlock[]
  created_at?: string
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const user = message.role === 'user'
  const visibleBlocks = message.content.filter(
    (block) => block.type === 'text' || block.type === 'data'
  )

  return (
    <article
      className={`max-w-[90%] rounded-xl border p-3 ${user ? 'ml-auto bg-primary/5' : 'mr-auto bg-card'}`}
    >
      <header className='mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground'>
        <span>
          {user ? (
            <LocalizedText text='我' />
          ) : message.role === 'assistant' ? (
            <LocalizedText text='智能体' />
          ) : (
            <LocalizedText text='系统' />
          )}
        </span>
        <time>
          {message.created_at
            ? new Date(message.created_at).toLocaleString()
            : null}
        </time>
      </header>
      <div className='space-y-2 text-sm'>
        {visibleBlocks.map((block, index) =>
          block.type === 'text' ? (
            <p
              key={`${message.id}:${index}`}
              className='break-words whitespace-pre-wrap'
            >
              {block.text}
            </p>
          ) : (
            <div
              key={`${message.id}:${index}`}
              className='rounded border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground'
            >
              <Paperclip className='mr-1 inline size-3.5' />
              {block.name || block.source?.media_type || '附件'}
            </div>
          )
        )}
        {!visibleBlocks.length && (
          <p className='text-xs text-muted-foreground'>
            <LocalizedText text='此消息包含尚未支持展示的内容。' />
          </p>
        )}
      </div>
    </article>
  )
}
