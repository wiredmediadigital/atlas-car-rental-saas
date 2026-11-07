import { ORG_ROLES, PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/authz/permissions'
import { getAppName } from '@/lib/config/env'

import { SUPPORT_EMAIL } from './constants'
import { isPermissionKey, roleLabelFor } from './permission-labels'

/**
 * Help prose never writes the product name or support address literally. It
 * writes `{{productName}}` and `{{supportEmail}}`, resolved at render time, so a
 * deployment renamed through VITE_APP_NAME does not ship documentation for a
 * product its staff have never heard of.
 *
 * `{{roleTable}}` exists for the same reason, one level up. Help pages name
 * permission keys and let the label derive, precisely so no page becomes a
 * second, hand-maintained copy of the permission matrix. But two pages have the
 * roles themselves as their subject — Team, and the "Who can do what"
 * reference — and a page that may not say "Administrator" cannot answer the
 * question those readers arrived with. So they say it, and they get the words
 * from `ROLE_LABELS` and `ROLE_DESCRIPTIONS` rather than retyping them. Rename
 * a role or reword what it covers, and the help text follows without anybody
 * remembering to edit Markdown.
 *
 * `{{permissionMatrix}}` is the same argument carried to its end. The "Who can
 * do what" page exists to answer "may I do this", and the only honest answer
 * is the whole of `PERMISSIONS`. Typed into Markdown that would be sixty rows
 * free to drift from the matrix they claim to describe, and the first drift
 * would tell somebody they may do something the database refuses. Generated,
 * it cannot drift, and a permission added to the matrix appears on the page the
 * same day.
 *
 * Only these four tokens are replaced. Any other `{{...}}` sequence is left
 * as written so a typo such as `{{productname}}` stays visible in the rendered
 * page and is caught in review, rather than silently vanishing.
 *
 * Replacers are functions so a name containing `$&` or `$1` is inserted literally.
 */
export function resolveTokens(markdown: string): string {
  return markdown
    .replaceAll('{{productName}}', () => getAppName())
    .replaceAll('{{supportEmail}}', () => SUPPORT_EMAIL)
    .replaceAll('{{roleTable}}', () => roleTable())
    .replaceAll('{{permissionMatrix}}', () => permissionMatrix())
}

/** A pipe inside a cell would end it early and shift every column after it. */
function cell(text: string): string {
  return text.replaceAll('|', '\\|')
}

/**
 * The four roles as a GitHub-flavoured Markdown table, highest first.
 *
 * `ORG_ROLES` is already ordered owner → staff, so the rows read down from most
 * access to least without this module deciding an order of its own.
 *
 * A pipe inside a label or description would end the cell early and silently
 * shift every column after it. Nothing in the matrix contains one today; the
 * escape is here so that adding one is a rendering detail rather than a broken
 * table on a public page.
 *
 * Expanding to several lines is safe because `HelpArticlePage` resolves tokens
 * *before* it reads the page's sections, so the heading line numbers that carry
 * the role labels are counted against the text that is actually rendered.
 */
function roleTable(): string {
  return [
    '| Role | What it covers |',
    '| --- | --- |',
    ...ORG_ROLES.map((role) => `| ${cell(ROLE_LABELS[role])} | ${cell(ROLE_DESCRIPTIONS[role])} |`),
  ].join('\n')
}

/**
 * What a `staff` minimum reads as in this table.
 *
 * `roleLabelFor` returns null there, because beside a task heading every member
 * holds it and a badge would be noise. A blank cell in a matrix says "unknown"
 * rather than "anyone", so here it is said in words.
 */
const HELD_BY_EVERY_MEMBER = 'Everyone in the agency'

/**
 * Every gated action in `PERMISSIONS`, with the role label each one derives.
 *
 * Rows keep the matrix's own declaration order, which already groups by
 * resource and reads organization → team → fleet → customers → contracts →
 * money → tracking → reports → billing. Re-sorting here would be this module
 * deciding an order the matrix did not.
 */
function permissionMatrix(): string {
  return [
    '| Permission | Who can do it |',
    '| --- | --- |',
    ...Object.keys(PERMISSIONS).map((key) => {
      const label = isPermissionKey(key) ? roleLabelFor(key) : null
      return `| \`${cell(key)}\` | ${cell(label ?? HELD_BY_EVERY_MEMBER)} |`
    }),
  ].join('\n')
}
