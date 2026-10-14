import { toast } from 'sonner'
import { ApiProblem } from '@/lib/api'

export function handleServerError(error: unknown) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(error)
  }

  let errMsg = 'Something went wrong!'

  if (error instanceof ApiProblem) {
    errMsg = error.status === 204 ? 'No content.' : error.message || errMsg
  } else if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    Number(error.status) === 204
  ) {
    errMsg = 'No content.'
  }

  toast.error(errMsg)
}
