import { isPermissionKey, roleLabelFor, sectionPermissions } from './permission-labels'

/**
 * One task section of a help page: a `##` heading and whatever that heading is
 * allowed to claim about who may do it.
 */
export interface HelpSection {
  /**
   * The heading as a reader sees it — inline Markdown delimiters removed, so
   * this is display text and never source text. `id` is derived from it, and
   * "On this page" prints it.
   */
  readonly heading: string
  /** The anchor the heading renders with, and that "On this page" links to. */
  readonly id: string
  /** The derived role label, or `null` when every member holds the permission. */
  readonly roleLabel: string | null
  /**
   * The 1-based source line of the `##`, which is how the renderer finds this
   * section again. Identity is settled here and nowhere else: the `h2`
   * component looks a section up by the position Markdown parsing gave it,
   * rather than re-deriving a slug from the text it is about to render. Two
   * derivations from two different strings can disagree, and when they do a
   * role label disappears without an error.
   */
  readonly line: number
}

/**
 * A level-two ATX heading, and only a level two: `###` is a detail inside a
 * task, not a task of its own, and must not pick up a label or a jump link.
 *
 * Setext headings (`Heading` over `------`) are not recognised. One that slipped
 * into a help page would render as an `<h2>` with no label and no jump link,
 * which is wrong but harmless — it cannot shift a label onto a neighbouring
 * section, because sections are matched by source position rather than counted.
 */
const TASK_HEADING_PATTERN = /^##[ \t]+(.+?)[ \t]*$/

/** The opening or closing line of a fenced code block. */
const CODE_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/

/**
 * Inline Markdown, removed so a heading reads the same in the right rail as it
 * does on the page.
 *
 * `_` is deliberately left alone. CommonMark only treats it as emphasis at a
 * word boundary, and a help heading is far likelier to contain a literal
 * underscore — `rentals_view`, a column name, a file name — than an italic.
 * Mangling an identifier is a worse failure than leaving one asterisk-free
 * italic unstripped, so authors should use `*` for emphasis in headings.
 */
function stripInlineMarkdown(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!~])/g, '$1')
    .trim()
}

/**
 * The anchor for a heading. Empty when the heading has nothing to slug.
 *
 * Module-private on purpose. An exported slugger is an invitation to slug a
 * heading a second time somewhere else, from a slightly different string, and
 * the two then disagree about where a jump link points and which section owns
 * a role label. `helpSections` settles heading identity; everything else reads
 * `HelpSection.id`.
 */
function headingId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Pairs each task section with its own permission.
 *
 * `sectionPermissions` returns a page's keys in document order and says nothing
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
 * Lines inside a fenced code block are skipped, so a `##` in a sample is a
 * sample and not a task.
 *
 * An unknown key yields no label rather than an error. `content-validation.test.ts`
 * already fails the build for one, which is where a typo should be caught; a
 * page in a browser should not blow up over a label.
 */
export function helpSections(body: string): readonly HelpSection[] {
  const lines = body.split('\n')
  const found: { heading: string; index: number }[] = []
  let fence: string | null = null

  lines.forEach((line, index) => {
    const fenceMatch = CODE_FENCE_PATTERN.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0] ?? ''
      if (fence === null) fence = marker
      else if (marker === fence) fence = null
      return
    }
    if (fence !== null) return

    const headingMatch = TASK_HEADING_PATTERN.exec(line)
    if (headingMatch) {
      found.push({ heading: stripInlineMarkdown(headingMatch[1] ?? ''), index })
    }
  })

  return found.map((entry, position) => {
    const sectionEnd = found[position + 1]?.index ?? lines.length
    const [permission] = sectionPermissions(lines.slice(entry.index + 1, sectionEnd).join('\n'))

    return {
      heading: entry.heading,
      id: headingId(entry.heading) || `section-${position + 1}`,
      roleLabel:
        permission !== undefined && isPermissionKey(permission) ? roleLabelFor(permission) : null,
      line: entry.index + 1,
    }
  })
}
