import { isPermissionKey, roleLabelFor, sectionPermissions } from './permission-labels'

/**
 * One task section of a help page: a `##` heading and whatever that heading is
 * allowed to claim about who may do it.
 */
export interface HelpSection {
  /** The heading text, exactly as the author wrote it. */
  readonly heading: string
  /** The anchor the heading renders with, and that "On this page" links to. */
  readonly id: string
  /** The derived role label, or `null` when every member holds the permission. */
  readonly roleLabel: string | null
}

/**
 * A level-two heading, and only a level two: `###` is a detail inside a task,
 * not a task of its own, and must not pick up a label or a jump link.
 */
const TASK_HEADING_PATTERN = /^##[ \t]+(.+?)[ \t]*$/gm

/** The anchor for a heading. Empty when the heading has nothing to slug. */
export function headingId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Pairs each task section with its own permission.
 *
 * `sectionPermissions` returns a page's keys in document order but says nothing
 * about which heading each one belongs to, and the association is the whole
 * point: Team is staff to view, administrator to invite and owner to transfer,
 * so a label hung on the wrong section tells a reader they may do something the
 * database will refuse — or that they may not do something they can.
 *
 * Rather than parse the permission comments again here, the body is cut at each
 * heading and the existing reader is run over one section's text at a time. A
 * key can then only be attributed to the section it was written in: a comment
 * in the opening prose belongs to no section, and a comment under the second
 * heading cannot be claimed by the first.
 *
 * An unknown key yields no label rather than an error. `content-validation.test.ts`
 * already fails the build for one, which is where a typo should be caught; a
 * page in a browser should not blow up over a label.
 */
export function helpSections(body: string): readonly HelpSection[] {
  const headings = [...body.matchAll(TASK_HEADING_PATTERN)]

  return headings.map((match, index) => {
    const heading = match[1] ?? ''
    const sectionStart = match.index + match[0].length
    const sectionEnd = headings[index + 1]?.index ?? body.length
    const [permission] = sectionPermissions(body.slice(sectionStart, sectionEnd))

    return {
      heading,
      id: headingId(heading) || `section-${index + 1}`,
      roleLabel:
        permission !== undefined && isPermissionKey(permission) ? roleLabelFor(permission) : null,
    }
  })
}
