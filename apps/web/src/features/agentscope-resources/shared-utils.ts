import { ApiProblem } from '@/lib/api'

export const panel = 'rounded-xl border bg-card p-5'

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

export function formatDate(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function parseJsonObject(value: string, field: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${field} 必须是有效 JSON。`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`${field} 必须是 JSON 对象。`)
  return parsed as Record<string, unknown>
}

export function isConflict(error: unknown) {
  return error instanceof ApiProblem && error.status === 409
}
