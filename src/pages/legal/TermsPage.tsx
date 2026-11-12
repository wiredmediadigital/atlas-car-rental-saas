import { LegalLayout, LegalList, LegalSection } from './LegalLayout'
import { LEGAL } from './legal-config'

/**
 * The agreement between this deployment and the agencies that subscribe to it.
 *
 * The governing-law clause renders only when a jurisdiction has been
 * configured; see `legal-config.ts` for why an absent clause beats a
 * placeholder one.
 */
export function TermsPage() {
  const legal = LEGAL()
  const product = legal.productName

  return (
    <LegalLayout
      title="Terms of service"
      summary={`The agreement between your agency and ${product} — what the service does, what it costs, and what each side is responsible for.`}
    >
      <LegalSection heading="The agreement">
        <p>
          These terms are an agreement between your agency and {legal.entityName}, which provides{' '}
          {product}. Where they say &ldquo;we&rdquo;, it means {legal.entityName}.
        </p>
        <p>
          They apply when your agency creates an account and uses {product}. The person who creates
          the account confirms they may accept these terms on the agency&rsquo;s behalf.
        </p>
      </LegalSection>

      <LegalSection heading="What the service is">
        <p>
          {product} is software for running a car rental agency: fleet, bookings, contracts,
          customers, payments and reporting. It is provided as it stands and is improved over time.
          We may change features, and will not remove something you depend on without notice.
        </p>
      </LegalSection>

      <LegalSection heading="Accounts and access">
        <LegalList
          items={[
            'You are responsible for who you invite and what role you give them.',
            'Every person who uses the service must set up two-factor authentication. This is required, not optional, because the records held here include your renters’ identity and driving documents.',
            'Keep sign-in credentials and recovery codes secure, and tell us promptly if you believe an account has been compromised.',
            'Every agency must keep at least one active owner.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="Subscription, trial and billing">
        <LegalList
          items={[
            'Where a free trial is offered, its length is shown at checkout. No charge is made during the trial.',
            'Subscriptions renew automatically for the period you chose, at the price shown when you subscribed.',
            'Payments are taken through Stripe. We do not see or store your card details.',
            'If a price changes, the new price applies from your next renewal, and we will tell you before it does.',
            'If a payment fails, we will tell you and try again. If it stays unpaid, the account becomes read-only until it is settled — your records stay intact and exportable, and are not deleted for non-payment.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="Cancelling">
        <p>
          You can cancel at any time from Billing. Cancelling stops the next renewal; the
          subscription runs to the end of the period you have already paid for. We do not refund
          part-used periods unless the law requires it, or unless we have failed to provide the
          service.
        </p>
        <p>
          After a subscription ends, your records remain readable and exportable rather than being
          deleted, so cancelling never traps your data.
        </p>
      </LegalSection>

      <LegalSection heading="Closing your account">
        <p>
          An owner can ask to close the agency&rsquo;s account from Settings. Nothing is deleted
          when they do. The account is suspended at once: it becomes read-only, is clearly labelled
          as closing, and shows the date on which its data will be permanently deleted.
        </p>
        <LegalList
          items={[
            'Grace period. Deletion happens after the end of the 30-day grace period that starts with the request. Until then any owner or administrator can restore the account in one click. Records stay readable and exportable throughout, so use the time to export what you need.',
            'Restoring. The account becomes writable again if its subscription is still active. If it has been cancelled, restoring brings your records back but leaves the account read-only until the subscription is started again, which you can do from Billing.',
            'Deleting sooner. There is no self-service way to delete immediately. If you want your data deleted before the 30 days are up, ask us and we will action it as soon as we reasonably can.',
            'Your subscription. Closing the account does not itself cancel the subscription, so it keeps running and keeps billing. You cancel it yourself from Manage billing, which stays available while the account is suspended. The account is deleted only after the subscription has ended and the grace period is over.',
            'No refund. We do not refund the remainder of a period you have already paid for, and anything charged before you cancel is not refunded. Cancelling stops the next renewal.',
            'What is deleted. At the end of the grace period your agency’s records and files are permanently deleted, and team members who belong to no other agency lose their sign-in. This cannot be undone.',
            'What we keep. Billing records are kept, with your agency’s legal name, for the period required by the tax law that applies to us. We also keep a record that the closure happened and when, with counts of what was removed and never their content.',
          ]}
        />
        <p>
          If you restore the account within the grace period, nothing is deleted and the closure
          request lapses. Deletion normally happens on the day the grace period ends; it can be
          later if the subscription has not yet ended, because we never delete an account that is
          still being billed.
        </p>
      </LegalSection>

      <LegalSection heading="Your data belongs to you">
        <p>
          The records your agency puts into {product} are yours. We hold them to run the service and
          for nothing else. You can export your data at any time, and ask us to delete it when you
          close your account, as described above. How we handle personal data is set out in the
          privacy policy.
        </p>
      </LegalSection>

      <LegalSection heading="Using it properly">
        <p>You agree not to:</p>
        <LegalList
          items={[
            'use the service for anything unlawful, or to store data you have no right to hold;',
            'attempt to access another agency’s data, or to probe or disrupt the service;',
            'resell or redistribute the service without our agreement;',
            'upload anything designed to cause harm.',
          ]}
        />
        <p>
          You are responsible for having a lawful basis to hold the renter records you enter,
          including identity and driving documents.
        </p>
      </LegalSection>

      <LegalSection heading="Vehicle tracking">
        <p>
          If you connect a GPS provider, {product} will show you where your vehicles are and where
          they have been. That is location data about the person driving, not only about the car.
        </p>
        <LegalList
          items={[
            'Telling drivers is your job. You decide to track, so you are responsible for having a lawful basis and for telling renters and staff, in your own rental agreement, that the vehicle is tracked and what you do with the data.',
            'We only pass it through. The data comes from your provider’s hardware and network. We store and display it on your instructions; we do not decide what is tracked or for how long.',
            'It will sometimes be wrong or missing. Location depends on satellite signal, mobile coverage and a working device, none of which we control. Do not rely on it alone for anything that matters — recovering a vehicle, accusing someone, or evidence in a dispute.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="Availability">
        <p>
          We work to keep the service available, but we do not promise it will be uninterrupted or
          error-free. Maintenance, and failures at providers we depend on, can interrupt it.
        </p>
      </LegalSection>

      <LegalSection heading="Liability">
        <p>
          To the extent the law allows, we are not liable for indirect or consequential loss, or for
          lost profits, revenue or data. {product} is a record-keeping tool: decisions about who to
          rent a vehicle to, and on what terms, remain the agency&rsquo;s.
        </p>
        <p>
          Where we are liable, our total liability to you for everything arising under this
          agreement is limited to what you paid us in the twelve months before the claim arose. We
          set a limit because the subscription is small relative to the value of the business it
          supports, and we price it on that basis.
        </p>
        <p>
          Nothing here limits liability that cannot lawfully be limited &mdash; including death or
          personal injury caused by negligence, and fraud.
        </p>
      </LegalSection>

      <LegalSection heading="Claims brought against us because of your use">
        <p>
          If someone brings a claim against us because of how your agency used {product} &mdash; the
          records you chose to hold, how you obtained them, what you did with them, or a breach of
          these terms &mdash; you will cover our reasonable costs and any damages, provided we tell
          you about the claim promptly and let you take part in handling it.
        </p>
        <p>
          This does not apply where the claim is about our own failure, such as a fault in the
          service or a security failure on our side.
        </p>
      </LegalSection>

      <LegalSection heading="Ending the agreement">
        <p>
          You can close your account at any time. We may suspend or end an account that breaches
          these terms, or where required by law — other than in serious cases, we will warn you
          first and give you a chance to put it right. We will give you a reasonable opportunity to
          export your data.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to these terms">
        <p>
          We may update these terms. If a change materially affects you, we will tell you before it
          takes effect. Continuing to use the service after that means you accept the updated terms.
        </p>
      </LegalSection>

      {legal.governingLaw === null ? null : (
        <LegalSection heading="Governing law">
          <p>
            This agreement is governed by the laws of {legal.governingLaw}, and the courts of{' '}
            {legal.governingLaw} have exclusive jurisdiction over any dispute arising from it.
          </p>
        </LegalSection>
      )}
    </LegalLayout>
  )
}
