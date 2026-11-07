import { loadHelpPages } from './content'
import type { HelpPage } from './types'

export interface HelpSearchResult {
  slug: string
  title: string
  excerpt: string
}

const MAX_RESULTS = 10
const MIN_QUERY_LENGTH = 2
const TITLE_WEIGHT = 100
const SUMMARY_WEIGHT = 10
const BODY_WEIGHT = 1
/** A body that repeats a word is not ten times more relevant. */
const MAX_BODY_HITS = 5
const EXCERPT_RADIUS = 60

const WORD = /[\p{L}\p{N}]+/gu

interface Word {
  text: string
  index: number
}

function wordsOf(text: string): readonly Word[] {
  return Array.from(text.toLowerCase().matchAll(WORD), (match) => ({
    text: match[0],
    index: match.index,
  }))
}

/** A word matches when it starts with the term, so results appear as the reader types. */
function hitsFor(words: readonly Word[], term: string): number {
  return words.filter((word) => word.text.startsWith(term)).length
}

/** Markdown reduced to the words a reader would read. */
function toPlainText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function excerptAround(text: string, term: string): string | undefined {
  const match = wordsOf(text).find((word) => word.text.startsWith(term))
  if (!match) return undefined

  const start = Math.max(0, match.index - EXCERPT_RADIUS)
  const end = Math.min(text.length, match.index + term.length + EXCERPT_RADIUS)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end).trim()}${suffix}`
}

function scorePage(page: HelpPage, terms: readonly string[]): number {
  const title = wordsOf(page.frontMatter.title)
  const summary = wordsOf(page.frontMatter.summary)
  const body = wordsOf(toPlainText(page.body))
  let score = 0

  for (const term of terms) {
    const termScore =
      (hitsFor(title, term) > 0 ? TITLE_WEIGHT : 0) +
      (hitsFor(summary, term) > 0 ? SUMMARY_WEIGHT : 0) +
      Math.min(hitsFor(body, term), MAX_BODY_HITS) * BODY_WEIGHT
    // Every word of the query has to be found somewhere on the page.
    if (termScore === 0) return 0
    score += termScore
  }
  return score
}

function excerptFor(page: HelpPage, terms: readonly string[]): string {
  const summary = page.frontMatter.summary
  const body = toPlainText(page.body)
  for (const term of terms) {
    const found = excerptAround(summary, term) ?? excerptAround(body, term)
    if (found) return found
  }
  // The match was in the title alone; the summary is the best line to show.
  return summary
}

/**
 * Searches the help pages by title, summary and body.
 *
 * A page matches when every word of the query starts some word on it. A title
 * match outranks a summary match, which outranks a body match. Nineteen pages
 * do not need an index, so each call simply scores them all.
 */
export function searchHelp(
  query: string,
  pages: readonly HelpPage[] = loadHelpPages(),
): readonly HelpSearchResult[] {
  if (query.trim().length < MIN_QUERY_LENGTH) return []
  const terms = wordsOf(query).map((word) => word.text)
  if (terms.length === 0) return []

  return pages
    .map((page) => ({ page, score: scorePage(page, terms) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.page.slug.localeCompare(b.page.slug))
    .slice(0, MAX_RESULTS)
    .map(({ page }) => ({
      slug: page.slug,
      title: page.frontMatter.title,
      excerpt: excerptFor(page, terms),
    }))
}
