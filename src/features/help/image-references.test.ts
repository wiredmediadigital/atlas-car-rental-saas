import { loadHelpPages } from './content'
import { extractImageReferences, HELP_IMAGE_MANIFEST, helpImageFileName } from './images'

/*
 * The files in public/help, by name. A lazy glob is used only for its keys, so
 * nothing is fetched and no Node API is needed in a browser-typed test.
 */
const filesOnDisk = new Set(
  Object.keys(import.meta.glob('../../../public/help/*', { query: '?url' })).map((path) =>
    path.slice(path.lastIndexOf('/') + 1),
  ),
)

const pages = loadHelpPages()
const references = pages.flatMap((page) =>
  extractImageReferences(page.body).map((reference) => ({ slug: page.slug, ...reference })),
)

describe('image references in help pages', () => {
  test('the extractor finds inline images and ignores commented-out ones', () => {
    const found = extractImageReferences(
      'Text ![One](/help/a.jpg) and\n\n![Two](/help/b.png "Title")\n\n<!-- ![Hidden](/help/c.jpg) -->',
    )

    expect(found).toEqual([
      { alt: 'One', src: '/help/a.jpg' },
      { alt: 'Two', src: '/help/b.png' },
    ])
  })

  test('the extractor finds reference-style images, including blank-alt ones', () => {
    const found = extractImageReferences(
      [
        '![Full][shot]  ![][blank]  ![Collapsed][]  ![Shortcut]  ![Unresolved][nowhere]',
        '',
        '[shot]: /help/a.jpg',
        '[BLANK]: </help/b.jpg> "Title"',
        '[collapsed]: /help/c.jpg',
        '[shortcut]: /help/d.jpg',
      ].join('\n'),
    )

    expect(found).toEqual([
      { alt: 'Full', src: '/help/a.jpg' },
      { alt: '', src: '/help/b.jpg' },
      { alt: 'Collapsed', src: '/help/c.jpg' },
      { alt: 'Shortcut', src: '/help/d.jpg' },
    ])
  })

  test('the extractor reads alt text that contains brackets', () => {
    const found = extractImageReferences(
      '![The [Pay] button](/help/a.jpg) and ![Escaped \\] bracket](/help/b.jpg) and ![](/help/c.jpg)',
    )

    expect(found).toEqual([
      { alt: 'The [Pay] button', src: '/help/a.jpg' },
      { alt: 'Escaped \\] bracket', src: '/help/b.jpg' },
      { alt: '', src: '/help/c.jpg' },
    ])
  })

  test('the alt gate catches a blank alt written in reference style', () => {
    const blank = extractImageReferences('![][x]\n\n[x]: /help/a.jpg').filter(
      (reference) => reference.alt.trim() === '',
    )

    expect(blank).toHaveLength(1)
  })

  test('every image referenced by a help page exists in public/help', () => {
    const missing = references.filter((reference) => {
      const fileName = helpImageFileName(reference.src)
      return fileName === undefined || !filesOnDisk.has(fileName)
    })

    expect(missing.map((reference) => `${reference.slug}: ${reference.src}`)).toEqual([])
  })

  test('every image referenced by a help page is in the manifest', () => {
    const unlisted = references.filter((reference) => {
      const fileName = helpImageFileName(reference.src)
      return fileName === undefined || !(fileName in HELP_IMAGE_MANIFEST)
    })

    expect(unlisted.map((reference) => `${reference.slug}: ${reference.src}`)).toEqual([])
  })

  test('every image referenced by a help page has alt text', () => {
    const withoutAlt = references.filter((reference) => reference.alt.trim() === '')

    expect(withoutAlt.map((reference) => `${reference.slug}: ${reference.src}`)).toEqual([])
  })

  test('every file in the manifest is in public/help, and the reverse', () => {
    expect([...filesOnDisk].sort()).toEqual(Object.keys(HELP_IMAGE_MANIFEST).sort())
  })

  /*
   * Scoped to the pages that exist today. This grows with the content on its
   * own: a page added to src/content/help is held to it from the moment it
   * lands. Task 11 completes the page set, and from there the rule reads as the
   * design states it — every page outside Reference carries one.
   */
  test('every existing page outside the Reference group carries an orientation image', () => {
    const bare = pages
      .filter((page) => page.frontMatter.group !== 'Reference')
      .filter((page) => extractImageReferences(page.body).length === 0)

    expect(bare.map((page) => page.slug)).toEqual([])
  })
})
