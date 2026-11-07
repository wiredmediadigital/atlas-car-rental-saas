import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { helpArticlePath } from '@/app/routes/paths'

import { getHelpPage } from '../content'

export interface HelpArticleLinkProps {
  slug: string
  children: ReactNode
  className?: string
}

/**
 * A link to one help page, rendered only while that page exists.
 *
 * Entry points name the page they want before it has been written. Rendering
 * nothing until it resolves keeps them from ever pointing at a 404.
 */
export function HelpArticleLink({ slug, children, className }: HelpArticleLinkProps) {
  if (!getHelpPage(slug)) return null
  return (
    <Link to={helpArticlePath(slug)} className={className}>
      {children}
    </Link>
  )
}
