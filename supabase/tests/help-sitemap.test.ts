import { existsSync, readdirSync, readFileSync } from 'node:fs'

import {
  buildRobots,
  buildSitemap,
  CONTENT_DIR,
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

  test('returns no origin when none is given, rather than inventing one', () => {
    expect(normaliseOrigin(undefined)).toBeNull()
    expect(normaliseOrigin('')).toBeNull()
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

  test('robots.txt names no sitemap when there is no origin', () => {
    const robots = buildRobots(null)

    expect(robots).toMatch(/^User-agent: \*$/m)
    expect(robots).toMatch(/^Allow: \/$/m)
    expect(robots).not.toMatch(/sitemap/i)
    expect(robots).not.toContain('example.com')
  })

  test('the committed robots.txt matches the builder, whatever origin it was generated for', () => {
    const robots = readFileSync(ROBOTS_PATH, 'utf8')
    const origin = /^Sitemap: (.+)\/sitemap\.xml$/m.exec(robots)?.[1] ?? null

    expect(robots).toBe(buildRobots(origin))
  })

  test('the committed sitemap.xml exists exactly when robots.txt names it, and matches the content folder', () => {
    const robots = readFileSync(ROBOTS_PATH, 'utf8')
    const origin = /^Sitemap: (.+)\/sitemap\.xml$/m.exec(robots)?.[1]

    expect(existsSync(SITEMAP_PATH)).toBe(origin !== undefined)
    if (origin !== undefined) {
      expect(readFileSync(SITEMAP_PATH, 'utf8')).toBe(buildSitemap(origin, listHelpSlugs()))
    }
  })

  test('the committed files never point crawlers at a placeholder host', () => {
    const committed = [ROBOTS_PATH, SITEMAP_PATH]
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(committed).not.toMatch(/example\.(com|org|net)/)
  })
})
