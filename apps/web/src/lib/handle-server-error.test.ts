import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem } from './api'
import { handleServerError } from './handle-server-error'

const toastError = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: {
    error: toastError,
  },
}))

beforeEach(() => {
  vi.mocked(toastError).mockClear()
})

describe('handleServerError', () => {
  it('shows a generic message when the error is not recognised', () => {
    handleServerError(new Error('network'))

    expect(toastError).toHaveBeenCalledWith('Something went wrong!')
  })

  it('maps a plain object with status 204 to the no-content message', () => {
    handleServerError({ status: 204 })

    expect(toastError).toHaveBeenCalledWith('No content.')
  })

  it('shows API problem details returned by the fetch client', () => {
    const error = new ApiProblem(422, 'VALIDATION_ERROR', 'Validation failed')
    handleServerError(error)

    expect(toastError).toHaveBeenCalledWith('Validation failed')
  })

  it('uses the generic message when an API problem has no useful detail', () => {
    const error = new ApiProblem(500, undefined, '')
    handleServerError(error)

    expect(toastError).toHaveBeenCalledWith('Request failed (500)')
  })

  it('maps API 204 problems to the no-content message', () => {
    handleServerError(new ApiProblem(204))

    expect(toastError).toHaveBeenCalledWith('No content.')
  })

  it('logs the error to the console in development', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = new Error('logged')

    handleServerError(err)

    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(err)

    log.mockRestore()
  })

  it('does not log the error to the console in production', () => {
    vi.stubEnv('DEV', false)

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = new Error('not logged')

    handleServerError(err)

    expect(log).not.toHaveBeenCalled()

    log.mockRestore()
  })
})
