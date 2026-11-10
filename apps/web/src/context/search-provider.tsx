import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { CommandMenu } from '@/components/command-menu'

type SearchContextType = {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  triggerRef: React.RefObject<HTMLButtonElement | null>
}

const SearchContext = createContext<SearchContextType | null>(null)

type SearchProviderProps = {
  children: React.ReactNode
}

export function SearchProvider({ children }: SearchProviderProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key.toLowerCase() !== 'k' ||
        event.metaKey === event.ctrlKey ||
        event.isComposing ||
        event.keyCode === 229
      )
        return

      const target = event.target
      if (target instanceof HTMLElement) {
        if (
          target.isContentEditable ||
          target.closest(
            'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'
          )
        )
          return
      }

      const quickNavigationOpen =
        document.querySelector('[data-quick-navigation][role="dialog"]') !==
        null
      const conflictingOverlay = document.querySelector(
        '[aria-modal="true"]:not([data-quick-navigation]), [role="dialog"][data-state="open"]:not([data-quick-navigation]), [role="menu"][data-state="open"], [role="listbox"][data-state="open"]'
      )
      if (conflictingOverlay && !quickNavigationOpen) return

      event.preventDefault()
      setOpen((current) => !current)
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  return (
    <SearchContext value={{ open, setOpen, triggerRef }}>
      {children}
      <CommandMenu />
    </SearchContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSearch = () => {
  const searchContext = useContext(SearchContext)

  if (!searchContext) {
    throw new Error('useSearch has to be used within SearchProvider')
  }

  return searchContext
}
