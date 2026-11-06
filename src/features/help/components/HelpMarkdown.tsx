import { isValidElement, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Badge } from '@/components/ui'

import { headingId, type HelpSection } from '../sections'

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
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->[ \t]*\r?\n?/g

/** Flattens a heading's rendered children back to the text they came from. */
function headingText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(headingText).join('')
  if (isValidElement(node)) {
    const { children } = node.props as { children?: ReactNode }
    return headingText(children)
  }
  return ''
}

function markdownComponents(sections: readonly HelpSection[]): Components {
  const byId = new Map(sections.map((section) => [section.id, section]))

  return {
    h2: ({ children }) => {
      const id = headingId(headingText(children))
      const roleLabel = byId.get(id)?.roleLabel ?? null

      return (
        <h2
          id={id}
          className="text-ink mt-10 flex scroll-mt-24 flex-wrap items-center gap-x-3 gap-y-1 text-lg"
        >
          <span>{children}</span>
          {roleLabel ? <Badge tone="neutral">{roleLabel}</Badge> : null}
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
    a: ({ href, children }) => {
      const isExternal = href?.startsWith('http') ?? false

      return (
        <a
          href={href}
          className="text-brand-700 underline underline-offset-2 hover:no-underline"
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
      {body.replace(HTML_COMMENT_PATTERN, '')}
    </Markdown>
  )
}
