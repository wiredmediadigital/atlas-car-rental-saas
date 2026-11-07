import { ORG_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/authz/permissions'
import { getAppName } from '@/lib/config/env'

import { SUPPORT_EMAIL } from './constants'

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
 * Only these three tokens are replaced. Any other `{{...}}` sequence is left
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
  const cell = (text: string): string => text.replaceAll('|', '\\|')

  return [
    '| Role | What it covers |',
    '| --- | --- |',
    ...ORG_ROLES.map((role) => `| ${cell(ROLE_LABELS[role])} | ${cell(ROLE_DESCRIPTIONS[role])} |`),
  ].join('\n')
}
