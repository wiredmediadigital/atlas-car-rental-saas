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

const RESERVED_HOSTS = ['example.com', 'example.org', 'example.net']

/** Hostnames in the text that are, or are subdomains of, an RFC 2606 documentation domain. */
function placeholderHosts(text: string): string[] {
  const hosts = [...text.matchAll(/https?:\/\/([^\s/<"]+)/g)].map((match) => match[1] ?? '')
  return hosts.filter((host) =>
    RESERVED_HOSTS.some((reserved) => host === reserved || host.endsWith(`.${reserved}`)),
  )
}

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

  // `url.origin` throws the path away. Accepting one would write a sitemap of
  // URLs that 404 and a robots.txt naming the wrong host root, with no warning.
  test.each(['https://rentals.example.org/app', 'https://rentals.example.org/app/'])(
    'rejects %s rather than silently dropping the subpath',
    (value) => {
      expect(() => normaliseOrigin(value)).toThrow(/no path/i)
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

  test('the committed files never point crawlers at a reserved placeholder host', () => {
    const committed = [ROBOTS_PATH, SITEMAP_PATH]
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(placeholderHosts(committed)).toEqual([])
  })

  test('the placeholder guard flags the reserved hosts and nothing that merely contains them', () => {
    expect(placeholderHosts(buildRobots('https://example.com'))).toEqual(['example.com'])
    expect(placeholderHosts(buildSitemap('https://www.example.org', ['a']))).toEqual([
      'www.example.org',
      'www.example.org',
    ])
    for (const domain of ['myexample.org', 'example.company', 'rentals.example.network']) {
      const origin = `https://${domain}`
      expect(placeholderHosts(buildRobots(origin))).toEqual([])
      expect(placeholderHosts(buildSitemap(origin, ['a']))).toEqual([])
    }
  })
})
