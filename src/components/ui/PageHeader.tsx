import { CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'
import { useInRouterContext, useLocation } from 'react-router-dom'

import { HelpArticleLink } from '@/features/help/components/HelpArticleLink'
import { helpSlugForRoute } from '@/features/help/route-topics'
import { cn } from '@/lib/utils/cn'

export interface PageHeaderProps {
  title: string
  description?: ReactNode
  /** Short contextual label above the title, e.g. the section this page belongs to. */
  eyebrow?: string
  actions?: ReactNode
  className?: string
}

/**
 * The header every module page opens with.
 *
 * It also carries the link to that module's help page, which is why no module
 * page mentions help: one place knows the route, so one place reaches them all.
 * The link exists only where `helpSlugForRoute` finds a written page.
 */
export function PageHeader(props: PageHeaderProps) {
  // Headers are rendered in isolation by some tests and previews; `useLocation`
  // throws outside a router, so there the header simply has no help link.
  return useInRouterContext() ? <RoutedPageHeader {...props} /> : <PageHeaderView {...props} />
}

function RoutedPageHeader(props: PageHeaderProps) {
  const { pathname } = useLocation()
  return <PageHeaderView {...props} helpSlug={helpSlugForRoute(pathname)} />
}

function PageHeaderView({
  title,
  description,
  eyebrow,
  actions,
  className,
  helpSlug = null,
}: PageHeaderProps & { helpSlug?: string | null }) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="text-xl leading-7 font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-ink-muted max-w-2xl text-[0.8125rem] leading-5">{description}</p>
        ) : null}
      </div>
      {/* Wraps rather than pushing the page sideways. A header with three
          actions is 495px wide on a phone, and `shrink-0` turned that into a
          horizontally scrolling page instead of a second line of buttons. */}
      {actions || helpSlug ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions}
          {helpSlug ? (
            <HelpArticleLink
              slug={helpSlug}
              className="text-ink-muted hover:text-ink hover:bg-surface-inset inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[0.8125rem] font-medium transition-colors"
            >
              <CircleHelp className="size-4" aria-hidden="true" />
              Help with this page
            </HelpArticleLink>
          ) : null}
        </div>
      ) : null}
    </header>
  )
}
