import type { ReactNode } from 'react'

import { PRODUCT_BRAND } from '@/lib/config/brand'

/**
 * The publisher credit, as a link when there is somewhere to send people and as
 * plain text when there is not.
 *
 * WHY THIS IS A COMPONENT AND NOT A TERNARY IN FOUR PLACES
 *
 * The credit appears on the sign-in panel (twice — the wide brand panel and the
 * narrow fallback), in the marketing footer, on the Settings about screen and
 * on the monetization guide. Each renders it differently, which is why the
 * styling is a prop; what must NOT differ is the decision about whether a URL
 * exists. Five copies of that decision is five places for the credit to vanish
 * the next time the publisher's website changes.
 *
 * WHY NULL IS CHECKED RATHER THAN THE STRING BEING FALSY
 *
 * `href=""` is not a missing link. It is a link to the current page: it
 * renders, it looks clickable, it reads as a link to a screen reader, and
 * clicking it silently reloads. A credit with no website must be text.
 */
export function CreatorCredit({
  children,
  className,
  rel = 'noopener noreferrer',
}: {
  /** What the credit reads — the attribution line, or the bare creator name. */
  children: ReactNode
  /** How the link is styled where it appears. Ignored when there is no URL. */
  className?: string
  rel?: string
}) {
  if (PRODUCT_BRAND.creatorUrl === null) return <>{children}</>

  return (
    <a href={PRODUCT_BRAND.creatorUrl} target="_blank" rel={rel} className={className}>
      {children}
    </a>
  )
}
