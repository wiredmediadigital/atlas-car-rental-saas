import { parseFrontMatter } from './frontmatter'

const page = (lines: readonly string[], body = 'Body text.\n') =>
  ['---', ...lines, '---', body].join('\n')

const full = [
  'title: Rentals',
  'group: Operations',
  'permission: rentals.view',
  'summary: Create and manage rentals.',
]

describe('parseFrontMatter', () => {
  test('parses title, group, permission and summary from front matter', () => {
    const { frontMatter } = parseFrontMatter(page(full), 'rentals.md')

    expect(frontMatter).toEqual({
      title: 'Rentals',
      group: 'Operations',
      permission: 'rentals.view',
      summary: 'Create and manage rentals.',
    })
  })

  test('returns the body with the front matter block removed', () => {
    const { body } = parseFrontMatter(page(full, '# Heading\n\nParagraph.\n'), 'rentals.md')

    expect(body).toBe('# Heading\n\nParagraph.\n')
  })

  test('parses a page with no permission key', () => {
    const { frontMatter } = parseFrontMatter(
      page(['title: Welcome', 'group: Getting started', 'summary: Start here.']),
      'welcome.md',
    )

    expect(frontMatter.permission).toBeUndefined()
    expect(frontMatter.title).toBe('Welcome')
  })

  test('throws naming the file when the front matter block is absent', () => {
    expect(() => parseFrontMatter('# Just a heading\n', 'bare.md')).toThrow(/bare\.md/)
  })

  test('throws naming the file and the missing key when group is absent', () => {
    const raw = page(['title: Rentals', 'permission: rentals.view', 'summary: S.'])

    expect(() => parseFrontMatter(raw, 'nogroup.md')).toThrow(
      /nogroup\.md.*group|group.*nogroup\.md/,
    )
  })

  test('throws naming the file and the missing key when title is absent', () => {
    const raw = page(['group: Fleet', 'summary: S.'])

    expect(() => parseFrontMatter(raw, 'notitle.md')).toThrow(
      /notitle\.md.*title|title.*notitle\.md/,
    )
  })

  test('throws naming the file and the missing key when summary is absent', () => {
    const raw = page(['title: T', 'group: Fleet'])

    expect(() => parseFrontMatter(raw, 'nosummary.md')).toThrow(
      /nosummary\.md.*summary|summary.*nosummary\.md/,
    )
  })

  test('throws naming the file when group is not one of the seven known groups', () => {
    const raw = page(['title: T', 'group: Misc', 'summary: S.'])

    expect(() => parseFrontMatter(raw, 'badgroup.md')).toThrow(/badgroup\.md/)
    expect(() => parseFrontMatter(raw, 'badgroup.md')).toThrow(/group/)
  })
})
