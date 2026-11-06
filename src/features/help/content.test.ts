import { getHelpPage, loadHelpPages } from './content'

describe('help content', () => {
  test('loads every markdown file in src/content/help as a page', () => {
    const pages = loadHelpPages()

    expect(pages.length).toBeGreaterThan(0)
    for (const page of pages) {
      expect(page.frontMatter.title).not.toBe('')
      expect(page.body.length).toBeGreaterThan(0)
    }
  })

  test('derives the slug from the file name without its extension', () => {
    const slugs = loadHelpPages().map((page) => page.slug)

    expect(slugs).toContain('rentals')
    for (const slug of slugs) expect(slug).not.toMatch(/[./]/)
  })

  test('getHelpPage returns undefined for a slug with no file', () => {
    expect(getHelpPage('no-such-page')).toBeUndefined()
    expect(getHelpPage('rentals')?.slug).toBe('rentals')
  })
})
