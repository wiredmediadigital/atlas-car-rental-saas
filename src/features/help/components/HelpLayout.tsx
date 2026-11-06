import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { paths } from '@/app/routes/paths'
import { Wordmark } from '@/components/brand/Wordmark'

export interface HelpLayoutProps {
  /** The page tree. Omitted on surfaces that are their own index. */
  sidebar?: ReactNode
  /** The right rail — "On this page" on an article. */
  aside?: ReactNode
  children: ReactNode
}

/**
 * The chrome around every Help Centre page.
 *
 * Deliberately not `AppShell`. The help routes sit outside every guard and are
 * read by people with no session — an invitee, somebody locked out of sign-in,
 * a prospect — so this layout imports nothing that belongs to the authenticated
 * application and nothing from another feature module. That is what keeps help
 * in its own lazy chunk.
 */
export function HelpLayout({ sidebar, aside, children }: HelpLayoutProps) {
  return (
    <div className="bg-canvas min-h-dvh">
      <header className="border-line bg-canvas/85 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1220px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            to={paths.overview}
            className="rounded-md focus-visible:outline-offset-4"
            aria-label="Home"
          >
            <Wordmark />
          </Link>
          {/* Links back to the index arrive with it, in Task 5. */}
          <p className="text-ink-subtle text-sm">Help centre</p>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1220px] items-start gap-10 px-4 py-10 sm:px-6 lg:px-8">
        {sidebar ? <div className="hidden w-52 shrink-0 lg:block">{sidebar}</div> : null}
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
        {aside ? <div className="hidden w-48 shrink-0 xl:block">{aside}</div> : null}
      </div>
    </div>
  )
}
