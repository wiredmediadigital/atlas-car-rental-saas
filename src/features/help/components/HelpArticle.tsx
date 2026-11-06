import { ChevronRight } from 'lucide-react'

import { Badge } from '@/components/ui'

import { isPermissionKey, roleLabelFor } from '../permission-labels'
import type { HelpSection } from '../sections'
import type { HelpPage } from '../types'

import { HelpMarkdown } from './HelpMarkdown'

/** The role label for the page as a whole, or null when there is nothing to say. */
function pageRoleLabel(permission: string | undefined): string | null {
  if (permission === undefined || !isPermissionKey(permission)) return null
  return roleLabelFor(permission)
}

export interface HelpArticleProps {
  page: HelpPage
  /** The page body with its tokens already resolved. */
  body: string
  /** The sections of that body, shared with "On this page". */
  sections: readonly HelpSection[]
}

/**
 * One help article: where the reader is, what the page is for, who may use the
 * module at all, and then the prose.
 *
 * The page-level label answers "may I open this section", which is a different
 * question from "may I do this particular thing" — that one is answered beside
 * each task heading, because most modules span several minimum roles. Both
 * labels are suppressed when the minimum is staff, since every member holds it
 * and the label would be noise.
 */
export function HelpArticle({ page, body, sections }: HelpArticleProps) {
  const { frontMatter } = page
  const roleLabel = pageRoleLabel(frontMatter.permission)

  return (
    <article>
      <nav aria-label="Breadcrumb">
        <ol className="text-ink-subtle flex items-center gap-1 text-xs">
          <li>{frontMatter.group}</li>
          <li aria-hidden="true" className="flex items-center">
            <ChevronRight className="size-3" />
          </li>
          <li className="text-ink-muted">{frontMatter.title}</li>
        </ol>
      </nav>

      <h1 className="text-ink mt-3 text-2xl">{frontMatter.title}</h1>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="text-ink-muted text-sm leading-6">{frontMatter.summary}</p>
        {roleLabel ? <Badge tone="neutral">{roleLabel}</Badge> : null}
      </div>

      <HelpMarkdown body={body} sections={sections} />
    </article>
  )
}
