/** Where the Help Centre is served from, at the site root. */
export const HELP_ROUTE_BASE = '/help'

export interface HelpLinkReference {
  /** The href exactly as the page wrote it, fragment and all. */
  readonly href: string
  /** The page it points at, or null for the Help Centre index itself. */
  readonly slug: string | null
}

/**
 * The help route behind an href, or undefined when the href points elsewhere.
 *
 * Elsewhere means anything this site does not serve under `/help`: another
 * origin, a `mailto:`, a bare `#anchor`, or a deeper path. A query or fragment
 * is kept on `href` — the router wants it — but is not part of the slug.
 */
export function helpRouteTarget(href: string): HelpLinkReference | undefined {
  const path = href.split(/[?#]/)[0] ?? ''
  if (path !== HELP_ROUTE_BASE && !path.startsWith(`${HELP_ROUTE_BASE}/`)) return undefined
  const rest = path.slice(HELP_ROUTE_BASE.length).replace(/^\//, '')
  if (rest.includes('/')) return undefined
  return { href, slug: rest === '' ? null : rest }
}

const HTML_COMMENT = /<!--[\s\S]*?-->/g

/* Link text may hold escapes and balanced brackets: [the [Pay] button](...) */
const LABEL = String.raw`((?:\\.|[^\[\]\\]|\[(?:\\.|[^\[\]\\])*\])*)`
const INLINE = String.raw`\(\s*(?:<([^>]*)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)`

/** [text](href), [text][ref], [text][] and [text]: the forms Markdown renders as a link. */
const MARKDOWN_LINK = new RegExp(String.raw`(!)?\[${LABEL}\](?:${INLINE}|\[([^\]]*)\])?`, 'g')

/** `[label]: href` definitions, which reference-style links resolve against. */
const DEFINITION = /^ {0,3}\[([^\]]+)\]:[ \t]*(?:<([^>]*)>|(\S+))/gm

function normaliseLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Every link into the Help Centre that a page body contains, in order.
 *
 * Images are skipped — `![alt](/help/x.jpg)` is a picture, and
 * `extractImageReferences` already holds those to the manifest. So is anything
 * pointing outside `/help`, which this module has no way to verify.
 *
 * This is a gate's view of the page, so it has to see what react-markdown will
 * render: a reference-style link that this missed would reach a public URL
 * unchecked. A reference with no matching definition renders as literal text,
 * not a link, and is skipped.
 */
export function extractHelpLinks(body: string): readonly HelpLinkReference[] {
  const text = body.replace(HTML_COMMENT, '')
  const definitions = new Map<string, string>()
  for (const match of text.matchAll(DEFINITION)) {
    const label = normaliseLabel(match[1] ?? '')
    if (!definitions.has(label)) definitions.set(label, match[2] ?? match[3] ?? '')
  }

  // A definition line is not itself a link; left in, `[label]: /help/x` would
  // also match the shortcut form `[label]` and be counted a second time.
  const prose = text.replace(DEFINITION, '')

  const links: HelpLinkReference[] = []
  for (const match of prose.matchAll(MARKDOWN_LINK)) {
    if (match[1] === '!') continue
    const label = match[2] ?? ''
    const isInline = match[3] !== undefined || match[4] !== undefined
    const refLabel = match[5] === undefined || match[5] === '' ? label : match[5]
    const href = isInline ? (match[3] ?? match[4]) : definitions.get(normaliseLabel(refLabel))
    if (href === undefined) continue
    const target = helpRouteTarget(href)
    if (target !== undefined) links.push(target)
  }
  return links
}
