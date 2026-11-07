import * as Dialog from '@radix-ui/react-dialog'
import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { paths } from '@/app/routes/paths'

export interface HelpMobileNavProps {
  /** The page tree, shown in the dialog. */
  children: ReactNode
}

/**
 * The page tree below `lg`, where the sidebar is hidden.
 *
 * Follows the dialog `MarketingHeader` uses for its own mobile menu. Radix
 * mounts the content only while open, so on a desktop the tree appears once —
 * in the sidebar — and never as a second landmark with the same name.
 */
export function HelpMobileNav({ children }: HelpMobileNavProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Choosing any link in the tree navigates; the dialog must not stay over it.
  function handleContentClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest('a')) setIsOpen(false)
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Trigger
        className="text-ink-muted hover:bg-surface-inset hover:text-ink -me-2 shrink-0 rounded-md p-2 transition-colors lg:hidden"
        aria-label="Open help navigation"
      >
        <Menu className="size-5" aria-hidden="true" />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#16181a]/40 backdrop-blur-[2px] lg:hidden" />
        <Dialog.Content
          className="bg-canvas fixed inset-y-0 end-0 z-50 flex w-72 max-w-[85vw] flex-col outline-none lg:hidden"
          aria-describedby={undefined}
          onClick={handleContentClick}
        >
          <Dialog.Title className="sr-only">Help navigation</Dialog.Title>
          <div className="border-line flex h-16 shrink-0 items-center justify-between border-b px-4">
            <Link to={paths.help} className="text-ink rounded-md text-sm font-medium">
              Help centre
            </Link>
            <Dialog.Close
              className="text-ink-muted hover:bg-surface-inset hover:text-ink -me-2 rounded-md p-2 transition-colors"
              aria-label="Close help navigation"
            >
              <X className="size-5" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
