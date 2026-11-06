import { useId } from 'react'
import { Link } from 'react-router-dom'

import { helpArticlePath } from '@/app/routes/paths'

import type { HelpGroup } from '../types'

export interface HelpGroupCardPage {
  readonly slug: string
  readonly title: string
}

export interface HelpGroupCardProps {
  group: HelpGroup
  pages: readonly HelpGroupCardPage[]
}

/**
 * One navigation group on the index: its name, and a link to each of its pages.
 * Rendered as a labelled region so a screen-reader user can jump between groups.
 */
export function HelpGroupCard({ group, pages }: HelpGroupCardProps) {
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-line rounded-lg border p-5 shadow-raised"
    >
      <h2 id={headingId} className="eyebrow">
        {group}
      </h2>
      <ul className="mt-3 space-y-0.5">
        {pages.map((page) => (
          <li key={page.slug}>
            <Link
              to={helpArticlePath(page.slug)}
              className="text-ink-muted hover:bg-surface-inset hover:text-ink -mx-2 block rounded-md px-2 py-1.5 text-sm transition-colors"
            >
              {page.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
