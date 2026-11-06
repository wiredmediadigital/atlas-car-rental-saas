import { Link } from 'react-router-dom'

import { helpArticlePath } from '@/app/routes/paths'
import { cn } from '@/lib/utils/cn'

import { getHelpPage } from '../content'
import { HELP_NAVIGATION } from '../navigation'

export interface HelpSidebarProps {
  /** The slug being read, marked `aria-current` in the tree. */
  activeSlug?: string
}

/**
 * The full page tree, the same on every article, so a reader always knows what
 * else exists. Titles come from each page's own front matter rather than being
 * typed here a second time — a renamed page renames its own link.
 */
export function HelpSidebar({ activeSlug }: HelpSidebarProps) {
  return (
    <nav aria-label="Help pages" className="sticky top-8">
      {HELP_NAVIGATION.map((entry) => (
        <div key={entry.group} className="mb-6 last:mb-0">
          <p className="eyebrow">{entry.group}</p>
          <ul className="mt-2 space-y-0.5">
            {entry.slugs.map((slug) => {
              const page = getHelpPage(slug)
              if (!page) return null
              const isActive = slug === activeSlug

              return (
                <li key={slug}>
                  <Link
                    to={helpArticlePath(slug)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'block rounded-md px-2 py-1.5 text-sm transition-colors',
                      isActive
                        ? 'bg-surface-inset text-ink font-medium'
                        : 'text-ink-muted hover:bg-surface-inset hover:text-ink',
                    )}
                  >
                    {page.frontMatter.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
