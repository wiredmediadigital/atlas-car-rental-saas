import { Alert } from '@/components/ui/Alert'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { useClosureState } from '@/features/organization/queries'
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
 * AND IT NAMES WHAT CAN ACTUALLY BE EXPORTED. A bare "exported as usual" would
 * still be wider than the truth — financing agreements and the team list have
 * no export — so the sentence lists the four books that do, plus reports. The
 * list grew once already: it used to name only rentals and reports, because
 * Customers, Vehicles and Expenses had an import and no export. A reassurance
 * that turns out to be untrue on the day somebody relies on it is worse than a
 * narrower sentence, so widen this only alongside the export it describes.
 */
export function RestrictedBanner() {
  const isRestricted = useIsBillingRestricted()
  const canManageBilling = usePermission('billing.manage')
  const { state: closureState } = useClosureState()

  if (!isRestricted) return null

  /*
   * CLOSURE WINS, as it does in app.require_write, which checks closure first
   * "so that is the reason given when both apply". An agency can be both: the
   * subscription lapses, then the owner requests closure. app.may_write needs
   * billing unrestricted AND the agency open, so in that state paying changes
   * nothing until the agency is restored, and the sentence below ("starting a
   * subscription restores normal working") would be false. ClosureBanner says
   * what is actually true. The precedence lives here, in one place.
   */
  if (closureState !== 'open') return null

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
        can be opened, searched and printed as usual. The rentals book, the customer directory, the
        fleet, the expense ledger and every report can still be exported.
      </p>
      <p className="mt-1">
        {canManageBilling
          ? 'Starting a subscription from Billing restores normal working immediately.'
          : 'An owner of this agency can restore normal working from Billing.'}
      </p>
    </Alert>
  )
}
