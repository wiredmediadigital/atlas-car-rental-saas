import { describe, expect, it } from 'vitest'

import { helpSections } from './sections'

/*
 * The hard part of the article page.
 *
 * `sectionPermissions` returns the permission keys of a page in document order
 * but says nothing about which heading each one belongs to. These tests pin the
 * association down, in plain data, with no React anywhere near them: a label
 * attached to the wrong task is worse than no label, because it tells a reader
 * they may do something the database will refuse.
 */

const BODY = [
  'An opening paragraph before any task section.',
  '',
  '<!-- permission: team.transferOwnership -->',
  '',
  '## Close a rental and take final payment',
  '<!-- permission: rentals.delete -->',
  '',
  'Prose belonging to the first task section.',
  '',
  '### A sub-heading inside that section',
  '<!-- permission: team.invite -->',
  '',
  '## Look up a contract',
  '<!-- permission: rentals.view -->',
  '',
  'Prose belonging to the second task section.',
  '',
  '## Something with no permission at all',
  '',
  'Prose belonging to the third task section.',
].join('\n')

describe('helpSections', () => {
  it('returns one section per level-two heading, in document order', () => {
    expect(helpSections(BODY).map((section) => section.heading)).toEqual([
      'Close a rental and take final payment',
      'Look up a contract',
      'Something with no permission at all',
    ])
  })

  it('labels a section from the permission comment that follows its own heading', () => {
    const [first] = helpSections(BODY)

    // rentals.delete is a manager's, so the label has something to say.
    expect(first?.roleLabel).toBe('Manager and above')
  })

  it('renders no label when every member holds the permission', () => {
    const [, second] = helpSections(BODY)

    // rentals.view is staff: a label here would be noise on every section.
    expect(second?.roleLabel).toBeNull()
  })

  it('renders no label for a section that declares no permission', () => {
    const [, , third] = helpSections(BODY)

    expect(third?.roleLabel).toBeNull()
  })

  it('does not attribute a permission written before the first heading to that heading', () => {
    // team.transferOwnership sits in the opening prose. If the association were
    // "first comment wins" rather than "the comment inside this section", the
    // first task would be labelled Owner only — a flatly wrong instruction.
    expect(helpSections(BODY)[0]?.roleLabel).not.toBe('Owner only')
  })

  it('does not treat a level-three sub-heading as a task section', () => {
    const headings = helpSections(BODY).map((section) => section.heading)

    expect(headings).not.toContain('A sub-heading inside that section')
  })

  it('gives each section an anchor id derived from its heading', () => {
    expect(helpSections(BODY).map((section) => section.id)).toEqual([
      'close-a-rental-and-take-final-payment',
      'look-up-a-contract',
      'something-with-no-permission-at-all',
    ])
  })

  it('falls back to a positional id when a heading slugs to nothing', () => {
    expect(helpSections('## ?!\n').map((section) => section.id)).toEqual(['section-1'])
  })

  it('records the source line of each heading, which is how the renderer finds it again', () => {
    expect(helpSections(BODY).map((section) => section.line)).toEqual([5, 13, 18])
  })

  it('reports the heading as a reader sees it, not as the author typed it', () => {
    // The right rail prints this string. Asterisks and link syntax in it would
    // be a different heading from the one rendered above the prose.
    const body = '## Close a **rental** and take `final` payment\n'

    expect(helpSections(body)[0]?.heading).toBe('Close a rental and take final payment')
  })

  it('slugs a linked heading from its text, not its target', () => {
    const body = '## [Rentals](/help/rentals)\n'

    expect(helpSections(body)[0]).toMatchObject({ heading: 'Rentals', id: 'rentals' })
  })

  it('leaves an underscore alone, because a heading is likelier to name a key than to be italic', () => {
    expect(helpSections('## About rentals_view\n')[0]?.heading).toBe('About rentals_view')
  })

  it('reads a body saved with Windows line endings exactly as it reads one without', () => {
    // A Markdown file authored on Windows reaches Vite before git normalises
    // anything. A stray `\r` used to make every heading fail to match, which
    // cost the whole page its labels and jump links without any error.
    expect(helpSections(BODY.replaceAll('\n', '\r\n'))).toEqual(helpSections(BODY))
  })

  it('still labels and anchors every section of a CRLF body', () => {
    const body = '## Delete a rental\r\n<!-- permission: rentals.delete -->\r\n\r\nProse.\r\n'

    expect(helpSections(body)).toEqual([
      {
        heading: 'Delete a rental',
        id: 'delete-a-rental',
        roleLabel: 'Manager and above',
        line: 1,
      },
    ])
  })

  it('drops an ATX closing sequence instead of slugging it', () => {
    expect(helpSections('## Close a rental ##\n')[0]).toMatchObject({
      heading: 'Close a rental',
      id: 'close-a-rental',
    })
  })

  it('keeps a hash that is part of the heading rather than closing it', () => {
    // No space before it, so it is not a closing sequence.
    expect(helpSections('## Tag a vehicle #1\n')[0]?.heading).toBe('Tag a vehicle #1')
  })

  it('does not treat a heading inside a fenced code block as a task section', () => {
    const body = [
      '## A real task',
      '',
      '```markdown',
      '## Not a task, a sample',
      '```',
      '',
      '## Another real task',
    ].join('\n')

    expect(helpSections(body).map((section) => section.heading)).toEqual([
      'A real task',
      'Another real task',
    ])
  })

  it('ignores a permission key that is not in the matrix rather than throwing', () => {
    const body = '## Do a thing\n<!-- permission: rentals.teleport -->\n'

    expect(helpSections(body)).toEqual([
      { heading: 'Do a thing', id: 'do-a-thing', roleLabel: null, line: 1 },
    ])
  })

  it('returns nothing for a body with no task sections', () => {
    expect(helpSections('Just a paragraph.\n')).toEqual([])
  })
})

describe('anchor ids', () => {
  // Asserted through `helpSections` rather than against the slugger, which is
  // module-private: an exported slugger is how a second, divergent derivation
  // of the same id gets written somewhere else.
  it('lowercases, strips punctuation and joins words with hyphens', () => {
    expect(helpSections('## Extend, substitute — or cancel?\n')[0]?.id).toBe(
      'extend-substitute-or-cancel',
    )
  })

  it('numbers the section when its heading has nothing to slug', () => {
    expect(helpSections('## —\n')[0]?.id).toBe('section-1')
  })
})

describe('helpSections with repeated headings', () => {
  const REPEATED = ['## Add a charge', '', '## Add a charge', '', '## Add a charge'].join('\n')

  it('gives every section its own id, keeping the first one plain', () => {
    const ids = helpSections(REPEATED).map((section) => section.id)

    expect(ids).toEqual(['add-a-charge', 'add-a-charge-2', 'add-a-charge-3'])
  })

  it('does not hand out an id a later heading already owns', () => {
    const body = ['## Notes', '', '## Notes', '', '## Notes 2'].join('\n')

    const ids = helpSections(body).map((section) => section.id)

    expect(new Set(ids).size).toBe(3)
  })

  it('never gives a heading the id the skip link targets', () => {
    const ids = helpSections(['## Main', '', '## Main'].join('\n')).map((section) => section.id)

    expect(ids).not.toContain('main')
    expect(new Set(ids).size).toBe(2)
  })

  it('keeps each repeated heading on its own source line', () => {
    expect(helpSections(REPEATED).map((section) => section.line)).toEqual([1, 3, 5])
  })
})
