import { loadHelpPages } from './content'
import { isPermissionKey, sectionPermissions } from './permission-labels'
import { HELP_GROUPS } from './types'

/*
 * This file is the build gate for help content. Pages are parsed at runtime,
 * so a bad permission key would otherwise only surface in the browser. Here it
 * fails `npm run verify` instead. Failure messages name the slug and the key.
 */
describe('help content validation', () => {
  test('every page front-matter permission key exists in PERMISSIONS (absent is legal, unknown is not)', () => {
    // Absence is deliberate: some pages have no matching key in the matrix
    // (Notifications, Getting started, Reference). Only a PRESENT key that is
    // unknown fails. Do not "fix" this by requiring a permission on every page.
    const problems = loadHelpPages()
      .filter((page) => page.frontMatter.permission !== undefined)
      .filter((page) => !isPermissionKey(page.frontMatter.permission as string))
      .map((page) => `${page.slug}: unknown permission key "${page.frontMatter.permission}"`)

    expect(problems, problems.join('\n')).toEqual([])
  })

  test('every section permission comment names a key that exists in PERMISSIONS', () => {
    const problems = loadHelpPages().flatMap((page) =>
      sectionPermissions(page.body)
        .filter((key) => !isPermissionKey(key))
        .map((key) => `${page.slug}: unknown section permission key "${key}"`),
    )

    expect(problems, problems.join('\n')).toEqual([])
  })

  test('every page declares one of the seven known groups', () => {
    expect(HELP_GROUPS).toHaveLength(7)
    const problems = loadHelpPages()
      .filter((page) => !(HELP_GROUPS as readonly string[]).includes(page.frontMatter.group))
      .map((page) => `${page.slug}: unknown group "${page.frontMatter.group}"`)

    expect(problems, problems.join('\n')).toEqual([])
  })
})
