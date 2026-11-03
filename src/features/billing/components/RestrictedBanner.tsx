import { Alert } from '@/components/ui/Alert'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { usePermission, useIsBillingRestricted } from '@/features/workspace/workspace-context'

/**
 * The sentence an agency sees when its records have gone read-only.
 *
 * WHY THIS EXISTS AT ALL, GIVEN THAT THE DATABASE ALREADY REFUSES.
 *
 * Because of what the refusal looks like. A blocked INSERT says "new row
 * violates row-level security policy". A blocked UPDATE or DELETE does not fail
 * at all — it matches no rows, and the interface reports that as "that record
 * could not be found". Neither sentence is true in any way a person can act on,
 * and somebody who met one of them would reasonably conclude the product was
 * broken rather than unpaid. The enforcement is in the database; the
 * explanation has to be here.
 *
 * WHY IT IS NOT DISMISSIBLE. It is not a notification about an event, it is a
 * description of the state the agency is in for as long as it is in it. There
 * is a dismissible notification for this too, in the bell, and dismissing that
 * one is deliberately still allowed.
 *
 * WHY THE OWNER AND EVERYBODY ELSE READ DIFFERENT SENTENCES. Only an owner can
 * reach Billing — `billing.manage` is owner-only in the permission matrix and
 * owner-only in the database. Showing a manager a button they cannot use, or
 * telling them to "restart the subscription" when they have no way to, would
 * just move the dead end one click further along. They are told what is
 * happening and who can fix it.
 *
 * WHAT IT DOES NOT SAY. It does not say the data will be deleted, because it
 * will not be. The single most important thing in this message is the sentence
 * confirming that everything recorded is still there and can still be taken
 * out.
 *
 * AND IT NAMES WHAT CAN ACTUALLY BE EXPORTED. "Exported as usual" would be a
 * promise the product does not yet keep: Rentals exports, and every report
 * exports, but Customers, Vehicles and Expenses have an import and no export.
 * A reassurance that turns out to be untrue on the day somebody relies on it is
 * worse than the narrower sentence. Widen it when those exports exist.
 */
export function RestrictedBanner() {
  const isRestricted = useIsBillingRestricted()
  const canManageBilling = usePermission('billing.manage')

  if (!isRestricted) return null

  return (
    <Alert
      tone="caution"
      title="This agency's records are read-only"
      className="mb-6"
      actions={
        canManageBilling ? (
          <ButtonLink to="/billing" size="sm" variant="primary">
            Go to Billing
          </ButtonLink>
        ) : null
      }
    >
      <p>
        There is no active subscription, so nothing new can be recorded &mdash; no rentals,
        contracts, customers, payments or expenses. Everything already recorded is still here and
        can be opened, searched and printed as usual; the rentals book and every report can still be
        exported.
      </p>
      <p className="mt-1">
        {canManageBilling
          ? 'Starting a subscription from Billing restores normal working immediately.'
          : 'An owner of this agency can restore normal working from Billing.'}
      </p>
    </Alert>
  )
}
