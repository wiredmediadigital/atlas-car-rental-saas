import { describe, expect, it } from 'vitest'

import { searchHelp } from './search'
import type { HelpPage } from './types'

function page(slug: string, title: string, summary: string, body: string): HelpPage {
  return { slug, frontMatter: { title, group: 'Operations', summary }, body }
}

const PAGES: readonly HelpPage[] = [
  page('alpha', 'Invoices', 'Bill a customer.', 'Create a draft, then send it.'),
  page('beta', 'Customers', 'People who rent.', 'Every invoice links back to a customer record.'),
  page('gamma', 'Fleet', 'Vehicles you own.', 'Park a vehicle, service it, retire it.'),
]

describe('searchHelp', () => {
  it('returns an empty list for a blank or single-character query', () => {
    expect(searchHelp('', PAGES)).toEqual([])
    expect(searchHelp('   ', PAGES)).toEqual([])
    expect(searchHelp('i', PAGES)).toEqual([])
    expect(searchHelp(' i ', PAGES)).toEqual([])
  })

  it('matches a page by a word in its title before one that matches only in the body', () => {
    const slugs = searchHelp('invoice', PAGES).map((result) => result.slug)

    expect(slugs).toEqual(['alpha', 'beta'])
  })

  it('ranks a summary match above a body match', () => {
    const pages = [
      page('body', 'One', 'Nothing here.', 'Talks about deposits at length.'),
      page('summary', 'Two', 'How deposits work.', 'Nothing here.'),
    ]

    expect(searchHelp('deposits', pages).map((result) => result.slug)).toEqual(['summary', 'body'])
  })

  it('matches case-insensitively', () => {
    expect(searchHelp('FLEET', PAGES).map((result) => result.slug)).toEqual(['gamma'])
    expect(searchHelp('fLeEt', PAGES)).toHaveLength(1)
  })

  it('matches the start of a word so results appear while the reader is still typing', () => {
    expect(searchHelp('invo', PAGES).map((result) => result.slug)).toContain('alpha')
  })

  it('requires every word of the query to match somewhere on the page', () => {
    expect(searchHelp('invoice vehicle', PAGES)).toEqual([])
    expect(searchHelp('draft invoice', PAGES).map((result) => result.slug)).toEqual(['alpha'])
  })

  it('returns an excerpt containing the matched term', () => {
    const [result] = searchHelp('record', PAGES)

    expect(result?.slug).toBe('beta')
    expect(result?.excerpt.toLowerCase()).toContain('record')
  })

  it('keeps the excerpt short and centred on a match deep in a long body', () => {
    const long = `${'filler '.repeat(200)}needle ${'padding '.repeat(200)}`
    const [result] = searchHelp('needle', [page('long', 'Long', 'Short.', long)])

    expect(result?.excerpt).toContain('needle')
    expect(result?.excerpt.length).toBeLessThan(200)
  })

  it('shows plain text, not Markdown syntax or comments, in the excerpt', () => {
    const body =
      '## Heading\n<!-- permission: x.y -->\n\nSee **[the ledger](/help/x)** for details.'
    const [result] = searchHelp('ledger', [page('md', 'Md', 'Short.', body)])

    expect(result?.excerpt).toContain('the ledger')
    expect(result?.excerpt).not.toMatch(/[*#[\]]|permission|<!--/)
  })

  it('falls back to the summary when the term only appears in the title', () => {
    const [result] = searchHelp('fleet', PAGES)

    expect(result?.title).toBe('Fleet')
    expect(result?.excerpt).toBe('Vehicles you own.')
  })

  it('returns an empty list when nothing matches', () => {
    expect(searchHelp('zebra', PAGES)).toEqual([])
  })

  it('caps results at ten', () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      page(`p${index}`, `Page ${index}`, 'About widgets.', 'Body.'),
    )

    expect(searchHelp('widgets', many)).toHaveLength(10)
  })

  it('ignores regular-expression characters in the query', () => {
    expect(searchHelp('(.*', PAGES)).toEqual([])
    expect(() => searchHelp('[a-', PAGES)).not.toThrow()
  })

  it('does not mutate the pages it is given', () => {
    const before = JSON.stringify(PAGES)
    searchHelp('invoice', PAGES)

    expect(JSON.stringify(PAGES)).toBe(before)
  })

  it('searches the real help content by default', () => {
    expect(searchHelp('rentals').some((result) => result.slug === 'rentals')).toBe(true)
  })
})
