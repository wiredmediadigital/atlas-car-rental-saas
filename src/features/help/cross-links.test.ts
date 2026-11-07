import { loadHelpPages } from './content'
import { extractHelpLinks, helpRouteTarget } from './links'
import { HELP_NAVIGATION } from './navigation'

/*
 * The pages link to each other constantly — that cross-linking is how a reader
 * who landed on the wrong page gets to the right one, and it is the whole
 * answer to the design's "unfindable" anti-goal. Nothing else in this branch
 * holds those links: rename or retire a page and every link to it becomes a 404
 * on a public URL, silently.
 *
 * So this is the gate. It reads the corpus as it stands rather than counting
 * anything, so adding, renaming or removing a page needs no edit here.
 */
const pages = loadHelpPages()
const slugs = new Set(pages.map((page) => page.slug))
const links = pages.flatMap((page) =>
  extractHelpLinks(page.body).map((link) => ({ from: page.slug, ...link })),
)

describe('cross-links between help pages', () => {
  test('the extractor finds inline links and ignores images, externals and anchors', () => {
    const found = extractHelpLinks(
      [
        'See [Rentals](/help/rentals) and the [index](/help).',
        '',
        '![A picture](/help/rentals-01-list.jpg)',
        '',
        '[Our site](https://example.com), [mail](mailto:a@b.com), [top](#charges).',
        '',
        '<!-- [Hidden](/help/nowhere) -->',
      ].join('\n'),
    )

    expect(found).toEqual([
      { href: '/help/rentals', slug: 'rentals' },
      { href: '/help', slug: null },
    ])
  })

  test('the extractor finds reference-style links without double-counting the definition', () => {
    const found = extractHelpLinks(
      [
        '[Full][team]  [Collapsed][]  [Shortcut]',
        '',
        '[team]: /help/team',
        '[collapsed]: /help/billing',
        '[shortcut]: /help/settings',
      ].join('\n'),
    )

    expect(found).toEqual([
      { href: '/help/team', slug: 'team' },
      { href: '/help/billing', slug: 'billing' },
      { href: '/help/settings', slug: 'settings' },
    ])
  })

  test('a query or fragment stays on the href but is not part of the slug', () => {
    expect(helpRouteTarget('/help/rentals#charges')).toEqual({
      href: '/help/rentals#charges',
      slug: 'rentals',
    })
  })

  test('a deeper path under /help is not a help route', () => {
    expect(helpRouteTarget('/help/rentals/extra')).toBeUndefined()
    expect(helpRouteTarget('https://example.com/help/rentals')).toBeUndefined()
  })

  test('the pages do link to each other, so this gate is guarding something', () => {
    expect(links.length).toBeGreaterThan(pages.length)
  })

  test('every cross-link resolves to a page that exists', () => {
    const dead = links.filter((link) => link.slug !== null && !slugs.has(link.slug))

    expect(dead.map((link) => `${link.from}: ${link.href}`)).toEqual([])
  })

  test('every cross-link target is reachable from the sidebar', () => {
    // A page that exists but is not in the tree is a page a reader cannot get
    // back to, so linking into one is the same dead end by another route.
    const listed = new Set(HELP_NAVIGATION.flatMap((entry) => entry.slugs))
    const unlisted = links.filter((link) => link.slug !== null && !listed.has(link.slug))

    expect(unlisted.map((link) => `${link.from}: ${link.href}`)).toEqual([])
  })
})
