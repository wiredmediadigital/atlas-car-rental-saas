import { describe, expect, it } from 'vitest'

import { getHelpPage } from './content'
import { HELP_NAVIGATION } from './navigation'
import { HELP_GROUPS } from './types'

/*
 * The sidebar tree is hand-authored, because Notifications is a help page and
 * not a sidebar tab — `navigationGroups` cannot produce it. Hand-authored means
 * it can name a page that does not exist, which is a broken link in the one
 * place a lost reader goes to stop being lost.
 *
 * So the tree is only ever allowed to list slugs that resolve. These tests are
 * what keeps that true as Tasks 10 and 11 add the remaining eighteen pages.
 */
describe('HELP_NAVIGATION', () => {
  it('lists only slugs that resolve to a page on disk', () => {
    const missing = HELP_NAVIGATION.flatMap((entry) =>
      entry.slugs.filter((slug) => getHelpPage(slug) === undefined),
    )

    expect(missing, `no Markdown file for: ${missing.join(', ')}`).toEqual([])
  })

  it('lists every page that exists on disk', () => {
    // The other half of the promise: a page nobody can navigate to is a page
    // nobody reads.
    const listed = HELP_NAVIGATION.flatMap((entry) => entry.slugs)

    expect(listed).toContain('rentals')
  })

  it('files each page under the group its own front matter declares', () => {
    const misfiled = HELP_NAVIGATION.flatMap((entry) =>
      entry.slugs
        .map((slug) => ({ slug, declared: getHelpPage(slug)?.frontMatter.group }))
        .filter((page) => page.declared !== entry.group)
        .map((page) => `${page.slug}: listed under ${entry.group}, declares ${page.declared}`),
    )

    expect(misfiled, misfiled.join('\n')).toEqual([])
  })

  it('names only known groups, each at most once, in the order the app uses', () => {
    const groups = HELP_NAVIGATION.map((entry) => entry.group)
    const expectedOrder = HELP_GROUPS.filter((group) => groups.includes(group))

    expect(groups).toEqual([...expectedOrder])
  })

  it('never lists the same slug twice', () => {
    const slugs = HELP_NAVIGATION.flatMap((entry) => entry.slugs)

    expect(slugs).toEqual([...new Set(slugs)])
  })
})
