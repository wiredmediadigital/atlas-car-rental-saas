import { describe, expect, it } from 'vitest'

import { headingId, helpSections } from './sections'

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

  it('ignores a permission key that is not in the matrix rather than throwing', () => {
    const body = '## Do a thing\n<!-- permission: rentals.teleport -->\n'

    expect(helpSections(body)).toEqual([
      { heading: 'Do a thing', id: 'do-a-thing', roleLabel: null },
    ])
  })

  it('returns nothing for a body with no task sections', () => {
    expect(helpSections('Just a paragraph.\n')).toEqual([])
  })
})

describe('headingId', () => {
  it('lowercases, strips punctuation and joins words with hyphens', () => {
    expect(headingId('Extend, substitute — or cancel?')).toBe('extend-substitute-or-cancel')
  })

  it('returns an empty string when a heading has nothing to slug', () => {
    expect(headingId('—')).toBe('')
  })
})
