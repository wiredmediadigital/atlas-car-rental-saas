import { readdirSync, readFileSync } from 'node:fs'

import {
  buildRobots,
  buildSitemap,
  CONTENT_DIR,
  DEFAULT_ORIGIN,
  listHelpSlugs,
  normaliseOrigin,
  ROBOTS_PATH,
  SITEMAP_PATH,
} from '../../scripts/build-help-sitemap.mjs'

const ORIGIN = 'https://rentals.example.org'

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1] ?? '')
}

describe('help sitemap', () => {
  test('lists the help index and one URL per Markdown file, derived from the folder', () => {
    const slugs = readdirSync(CONTENT_DIR)
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.replace(/\.md$/, ''))

    expect(listHelpSlugs()).toEqual([...slugs].sort())
    expect(locs(buildSitemap(ORIGIN, listHelpSlugs()))).toEqual([
      `${ORIGIN}/help`,
      ...[...slugs].sort().map((slug) => `${ORIGIN}/help/${slug}`),
    ])
  })

  test('is a well-formed urlset in the sitemaps.org namespace', () => {
    const xml = buildSitemap(ORIGIN, ['a'])

    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/)
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true)
  })

  test('escapes characters that are special in XML', () => {
    expect(locs(buildSitemap(ORIGIN, ['a&b']))).toContain(`${ORIGIN}/help/a&amp;b`)
  })

  test('accepts an origin with a trailing slash or a path-free http URL', () => {
    expect(normaliseOrigin('https://rentals.example.org/')).toBe(ORIGIN)
    expect(normaliseOrigin('http://localhost:5173')).toBe('http://localhost:5173')
  })

  test('falls back to the documented default when no origin is given', () => {
    expect(normaliseOrigin(undefined)).toBe(DEFAULT_ORIGIN)
  })

  test.each(['rentals.example.org', 'ftp://example.org', 'https://', 'not a url'])(
    'rejects %s as an origin',
    (value) => {
      expect(() => normaliseOrigin(value)).toThrow(/origin/i)
    },
  )

  test('robots.txt allows everything and points at the sitemap on the same origin', () => {
    const robots = buildRobots(ORIGIN)

    expect(robots).toMatch(/^User-agent: \*$/m)
    expect(robots).toMatch(/^Allow: \/$/m)
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
  })

  test('the committed robots.txt and sitemap.xml match the content folder', () => {
    const robots = readFileSync(ROBOTS_PATH, 'utf8')
    const origin = /^Sitemap: (.+)\/sitemap\.xml$/m.exec(robots)?.[1]

    expect(origin).toBeDefined()
    expect(robots).toBe(buildRobots(origin as string))
    expect(readFileSync(SITEMAP_PATH, 'utf8')).toBe(buildSitemap(origin as string, listHelpSlugs()))
  })
})
