import { SUPPORT_EMAIL } from '@/features/help/constants'
import { getAppName } from '@/lib/config/env'

export interface LegalDetails {
  /**
   * The company the agreement is with. Kept apart from `productName` on
   * purpose: the contracting party is the company, but the prose is about the
   * software, and collapsing the two produces sentences like "Adera Labs Inc,
   * trading as Pevvy is used by car rental agencies".
   */
  readonly entityName: string
  /** The software, as a reader knows it. Follows the deployment's own name. */
  readonly productName: string
  /** Where to write about privacy or the agreement. */
  readonly contactEmail: string
  /**
   * The date the Terms of service last changed. This is also the Terms
   * version every agency accepts: `app.current_terms_version()` returns it,
   * so moving it asks every agency to accept again. Change it only when the
   * Terms change.
   */
  readonly termsUpdated: string
  /** The date the privacy policy last changed. Independent of the Terms. */
  readonly privacyUpdated: string
  /** The date the data processing terms last changed. Independent of the Terms. */
  readonly dataProcessingUpdated: string
  /**
   * The jurisdiction whose law governs the agreement, or `null` when nobody
   * has decided yet.
   *
   * Null is a real state, not a missing value. A governing-law clause naming a
   * placeholder reads as unfinished to a customer and as unenforceable to a
   * lawyer, so the Terms omit the clause entirely rather than printing
   * something untrue. It stayed null until Adera Labs Inc was actually
   * registered — publishing a contract with a company that does not yet exist
   * is the one failure worse than an absent clause.
   */
  readonly governingLaw: string | null
}

/**
 * The handful of facts the legal pages cannot derive from the code.
 *
 * A function rather than a constant so a test can replace it, and so the
 * product name follows the deployment's own configuration rather than being
 * frozen at build time for a rebranded install.
 */
export function LEGAL(): LegalDetails {
  return {
    entityName: 'Adera Labs Inc',
    productName: getAppName(),
    contactEmail: SUPPORT_EMAIL,
    // Unchanged: the public booking page added no term to the agreement, and
    // moving this date asks every agency to accept the Terms again.
    termsUpdated: '12 November 2026',
    privacyUpdated: '14 November 2026',
    dataProcessingUpdated: '14 November 2026',
    governingLaw: 'the State of Delaware',
  }
}
