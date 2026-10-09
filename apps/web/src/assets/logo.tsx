import { type ImgHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import synapseMark from './brand/synapse-mark.png'

export function Logo({
  className,
  alt = 'Synapse',
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      id='synapse-logo'
      src={synapseMark}
      alt={alt}
      className={cn('size-6', className)}
      {...props}
    />
  )
}
