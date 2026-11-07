import Markdown, { type Components } from 'react-markdown'
import { Link } from 'react-router-dom'
import remarkGfm from 'remark-gfm'

import { Badge } from '@/components/ui'

import { helpRouteTarget } from '../links'
import type { HelpSection } from '../sections'

import { HelpImage } from './HelpImage'

/**
 * Help prose, rendered as React elements.
 *
 * `react-markdown` builds the element tree itself; nothing here goes near
 * `dangerouslySetInnerHTML`. That is not a stylistic preference — help content
 * is authored as Markdown and rendered on a page that is public by design, so
 * the one thing this renderer must never do is hand a string to the HTML
 * parser. No `rehype-raw`, for the same reason: raw HTML in a help file is not
 * markup, it is text somebody typed.
 *
 * The project has no Tailwind typography plugin, so each element carries its
 * own classes. That is more verbose than a `prose` class and considerably
 * easier to reason about: what a help page looks like is readable here.
 */

/**
 * HTML comments, which this renderer prints verbatim if they are left in —
 * without `rehype-raw` they arrive as text, not as markup.
 *
 * `<!-- permission: rentals.delete -->` is an instruction to this renderer, not
 * something to show a reader — it has already been read by `helpSections` and
 * turned into the label beside the heading. Stripping every comment rather than
 * that one shape keeps the rule simple and the prose free of author notes.
 */
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g

/** Shared by both link renderers below, so the two are indistinguishable to a reader. */
const LINK_CLASS = 'text-brand-700 underline underline-offset-2 hover:no-underline'

/**
 * Blanks the comments out without removing a single line break.
 *
 * Line numbers are load-bearing: `helpSections` records the source line of each
 * `##` and the `h2` renderer finds its section by the line Markdown parsing
 * reports. Deleting a comment line here would shift every heading below it by
 * one and detach every label from its task.
 */
function blankComments(body: string): string {
  return body.replace(HTML_COMMENT_PATTERN, (comment) => comment.replace(/[^\n]/g, ''))
}

/*
 * A heading's anchor and its role label come from `helpSections` and are never
 * recomputed here. The `h2` finds its section by the source line Markdown
 * parsing recorded, so the id on the element is by construction the id "On this
 * page" links to, whatever the heading contains.
 *
 * Deriving a second slug from the rendered children instead would be two
 * derivations from two different strings — the raw `## [Rentals](/help/rentals)`
 * slugs differently from the text "Rentals" it renders as — and when the two
 * disagree the role label silently vanishes. Counting rendered headings instead
 * would be worse: StrictMode invokes a component's render function twice, so a
 * cursor would be one section ahead by the second heading.
 */
function markdownComponents(sections: readonly HelpSection[]): Components {
  const byLine = new Map(sections.map((section) => [section.line, section]))

  return {
    h2: ({ node, children }) => {
      const line = node?.position?.start.line
      const section = line === undefined ? undefined : byLine.get(line)

      return (
        <h2
          id={section?.id}
          className="text-ink mt-10 flex scroll-mt-24 flex-wrap items-center gap-x-3 gap-y-1 text-lg"
        >
          <span>{children}</span>
          {section?.roleLabel ? <Badge tone="neutral">{section.roleLabel}</Badge> : null}
        </h2>
      )
    },
    h3: ({ children }) => <h3 className="text-ink mt-7 text-sm font-semibold">{children}</h3>,
    p: ({ children }) => <p className="text-ink-muted mt-4 text-sm leading-6">{children}</p>,
    ul: ({ children }) => (
      <ul className="text-ink-muted mt-4 list-disc space-y-2 ps-5 text-sm leading-6">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="text-ink-muted mt-4 list-decimal space-y-2 ps-5 text-sm leading-6">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="ps-1">{children}</li>,
    strong: ({ children }) => <strong className="text-ink font-semibold">{children}</strong>,
    code: ({ children }) => (
      <code className="bg-surface-inset text-ink rounded px-1 py-0.5 text-[0.8125rem]">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="bg-surface-inset border-line mt-4 overflow-x-auto rounded-lg border p-4 text-[0.8125rem]">
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-brand-200 text-ink-muted mt-4 border-s-2 ps-4 text-sm leading-6">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="border-line mt-10" />,
    img: ({ src, alt }) => <HelpImage src={typeof src === 'string' ? src : undefined} alt={alt} />,
    a: ({ href, children }) => {
      /*
       * A link from one help page to another is in-app navigation, and the
       * pages cross-link constantly. Left as a plain anchor it reloaded the
       * document and re-ran the whole bootstrap — providers, auth — to show a
       * page the router already had.
       *
       * Only `/help` routes are handed to the router. A `#` anchor is the
       * browser's own job, `mailto:` is the mail client's, and an external site
       * is nobody's business here, so those stay anchors.
       */
      const internal = href === undefined ? undefined : helpRouteTarget(href)
      if (internal !== undefined) {
        return (
          <Link to={internal.href} className={LINK_CLASS}>
            {children}
          </Link>
        )
      }

      const isExternal = href?.startsWith('http') ?? false

      return (
        <a
          href={href}
          className={LINK_CLASS}
          {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {children}
        </a>
      )
    },
    table: ({ children }) => (
      <div className="border-line mt-4 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-line text-ink-subtle border-b px-3 py-2 text-start text-xs font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-line text-ink-muted border-b px-3 py-2 align-top last:border-b-0">
        {children}
      </td>
    ),
  }
}

export interface HelpMarkdownProps {
  /** The body with its tokens already resolved. */
  body: string
  /** The sections of that same body, so each heading can carry its own label. */
  sections: readonly HelpSection[]
}

export function HelpMarkdown({ body, sections }: HelpMarkdownProps) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents(sections)}>
      {blankComments(body)}
    </Markdown>
  )
}
