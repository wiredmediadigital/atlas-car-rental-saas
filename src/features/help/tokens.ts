import { getAppName } from '@/lib/config/env'

import { SUPPORT_EMAIL } from './constants'

/**
 * Help prose never writes the product name or support address literally. It
 * writes `{{productName}}` and `{{supportEmail}}`, resolved at render time, so a
 * deployment renamed through VITE_APP_NAME does not ship documentation for a
 * product its staff have never heard of.
 *
 * Only these two tokens are replaced. Any other `{{...}}` sequence is left
 * as written so a typo such as `{{productname}}` stays visible in the rendered
 * page and is caught in review, rather than silently vanishing.
 *
 * Replacers are functions so a name containing `$&` or `$1` is inserted literally.
 */
export function resolveTokens(markdown: string): string {
  return markdown
    .replaceAll('{{productName}}', () => getAppName())
    .replaceAll('{{supportEmail}}', () => SUPPORT_EMAIL)
}
