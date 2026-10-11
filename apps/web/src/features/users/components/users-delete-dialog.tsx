'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { showSubmittedData } from '@/lib/show-submitted-data'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { type User } from '../data/schema'
import { LocalizedText } from '@/components/localized-text'

type UserDeleteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow: User
}

export function UsersDeleteDialog({
  open,
  onOpenChange,
  currentRow,
}: UserDeleteDialogProps) {
  const [value, setValue] = useState('')

  const handleDelete = () => {
    if (value.trim() !== currentRow.username) return

    onOpenChange(false)
    showSubmittedData(currentRow, 'The following user has been deleted:')
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      form='users-delete-form'
      disabled={value.trim() !== currentRow.username}
      title={
        <span className='text-destructive'>
          <AlertTriangle
            className='me-1 inline-block stroke-destructive'
            size={18}
          />{' '}
          <LocalizedText text={"\n          Delete User\n        "} /></span>
      }
      desc={
        <form
          id='users-delete-form'
          onSubmit={(e) => {
            e.preventDefault()
            handleDelete()
          }}
          className='space-y-4'
        >
          <p className='mb-2'>
            <LocalizedText text={"\n            Are you sure you want to delete"} />{' '}
            <span className='font-bold'>{currentRow.username}</span><LocalizedText text={"?\n            "} /><br />
            <LocalizedText text={"\n            This action will permanently remove the user with the role of"} />{' '}
            <span className='font-bold'>
              {currentRow.role.toUpperCase()}
            </span>{' '}
            <LocalizedText text={"\n            from the system. This cannot be undone.\n          "} /></p>

          <Label className='my-2'>
            <LocalizedText text={"\n            Username:\n            "} /><Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder='Enter username to confirm deletion.'
              autoFocus
            />
          </Label>

          <Alert variant='destructive'>
            <AlertTitle><LocalizedText text={"Warning!"} /></AlertTitle>
            <AlertDescription>
              <LocalizedText text={"\n              Please be careful, this operation can not be rolled back.\n            "} /></AlertDescription>
          </Alert>
        </form>
      }
      confirmText='Delete'
      destructive
    />
  )
}
