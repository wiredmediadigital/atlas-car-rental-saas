import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { paths } from '@/app/routes/paths'
import { Wordmark } from '@/components/brand/Wordmark'

import { HelpMobileNav } from './HelpMobileNav'
import { HelpSearch } from './HelpSearch'
import { HelpSidebar } from './HelpSidebar'

export interface HelpLayoutProps {
  /** The page tree. Omitted on the index, which lists the pages itself. */
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
      <a
        href="#main"
        className="bg-canvas text-ink border-line sr-only z-50 rounded-md border px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        Skip to content
      </a>
      <header className="border-line bg-canvas/85 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1220px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            to={paths.overview}
            className="rounded-md focus-visible:outline-offset-4"
            aria-label="Home"
          >
            <Wordmark />
          </Link>
          <HelpSearch />
          <Link
            to={paths.help}
            className="text-ink-subtle hover:text-ink hidden shrink-0 rounded-md text-sm transition-colors sm:block"
          >
            Help centre
          </Link>
          <HelpMobileNav>{sidebar ?? <HelpSidebar />}</HelpMobileNav>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1220px] items-start gap-10 px-4 py-10 sm:px-6 lg:px-8">
        {sidebar ? <div className="hidden w-52 shrink-0 lg:block">{sidebar}</div> : null}
        {/* `scroll-mt-24` clears the sticky header: without it the skip link
            jumps to the top of the article and the header — `top-0`, with an
            `h-16` row — covers the breadcrumb and half the `h1`. The same value
            as the in-article headings in `HelpMarkdown`, so every jump on the
            page lands the same distance down. */}
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 scroll-mt-24 outline-none">
          {children}
        </main>
        {aside ? <div className="hidden w-48 shrink-0 xl:block">{aside}</div> : null}
      </div>
    </div>
  )
}
