import { LegalLayout, LegalList, LegalSection } from './LegalLayout'
import { LEGAL } from './legal-config'

/**
 * What this software actually does with personal data.
 *
 * Written from the schema rather than from a template, because the part a
 * template invents — the list of what is collected and where it goes — is the
 * part a reader can check and the part a regulator asks about.
 */
export function PrivacyPolicyPage() {
  const legal = LEGAL()
  const product = legal.productName

  return (
    <LegalLayout
      title="Privacy policy"
      summary={`How ${product} handles personal data — both the accounts of the agencies who use it, and the renter records those agencies keep in it.`}
    >
      <LegalSection heading="Who we are">
        <p>
          {product} is operated by {legal.entityName}. Where this policy says &ldquo;we&rdquo;, it
          means {legal.entityName}.
        </p>
      </LegalSection>

      <LegalSection heading="Two different relationships">
        <p>
          {product} is used by car rental agencies. That creates two separate relationships, and
          they are governed differently. Treating them as one is the most common mistake in a policy
          like this, so they are kept apart here.
        </p>
        <LegalList
          items={[
            <>
              <strong className="text-ink font-medium">Your agency&rsquo;s own account.</strong> We
              decide what is collected and why, so for this we are the{' '}
              <strong className="text-ink font-medium">data controller</strong>.
            </>,
            <>
              <strong className="text-ink font-medium">
                The renter records your agency puts in.
              </strong>{' '}
              Your agency decides what to collect and why; we hold it and act on the agency&rsquo;s
              instructions. For this we are a{' '}
              <strong className="text-ink font-medium">data processor</strong>, and the agency is
              the controller.
            </>,
          ]}
        />
        <p>
          If you rented a vehicle from an agency that uses {product} and want to know what is held
          about you, ask that agency. They decide what is kept and for how long; we cannot answer
          for them, and we do not use their records for anything of our own.
        </p>
      </LegalSection>

      <LegalSection heading="What we hold about your agency">
        <LegalList
          items={[
            'The name and email address of each person you invite, their role, and whether their account is active.',
            'Sign-in records, including the times of sign-in attempts, used to keep accounts secure.',
            'Your agency name, address, time zone, currency and tax settings.',
            'Your subscription status, plan and billing history.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="What your agency holds in the product">
        <p>
          These records belong to the agency. We process them so the software works, and for no
          other purpose — we do not read them, sell them, or use them to train anything.
        </p>
        <LegalList
          items={[
            'Renter and driver details: name or company name, email, phone numbers, date of birth, nationality and address.',
            'Identity and driving documents: the document type, its number, issuing country, issue and expiry dates, licence classes, and any scan the agency uploads — including passports, national identity cards, residence permits and driving licences.',
            'Rental records: bookings, contracts, hand-over and return readings, condition photographs, charges, payments and refunds.',
            'Vehicle location data, where the agency has connected a GPS provider.',
            'Anything an agency writes into a free-text note.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="Who else the data reaches">
        <p>
          We use a small number of providers to run the service. Each is listed here because data
          genuinely passes through it, not as a precaution.
        </p>
        <LegalList
          items={[
            <>
              <strong className="text-ink font-medium">Supabase</strong> — hosting, the database,
              and storage for uploaded files such as document scans and condition photographs.
            </>,
            <>
              <strong className="text-ink font-medium">Stripe</strong> — subscription payments from
              agencies to us. Card details are entered on Stripe&rsquo;s own pages and are never
              stored by {product}.
            </>,
            <>
              <strong className="text-ink font-medium">Resend</strong> — outgoing email, such as
              sign-in links, password resets and team invitations.
            </>,
            <>
              <strong className="text-ink font-medium">Wialon</strong>, or another GPS provider, and
              only where an agency has connected one. Vehicle position data is exchanged with that
              provider under the agency&rsquo;s own account with them.
            </>,
          ]}
        />
        <p>
          We do not sell personal data, and we do not share it for advertising. We will disclose
          data where the law requires it.
        </p>
      </LegalSection>

      <LegalSection heading="How it is kept safe">
        <LegalList
          items={[
            'Every record is scoped to one agency at the database level, so one agency cannot read another’s data even if a request asks for it.',
            'Uploaded documents are stored privately. They are opened through links that expire within minutes, so a copied address stops working rather than becoming a passport page on the open internet.',
            'Access within an agency is limited by role, and the owner decides who holds which role.',
            'Traffic is encrypted in transit.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="How long it is kept">
        <p>
          Agency records are kept for as long as the agency has an account with us. An agency can
          delete records at any time, and can export its data before closing its account. When an
          account is closed we delete or anonymise its data, except where we are required to keep
          something — billing records, for instance, are kept for the period tax law requires.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          Depending on where you live, you may have the right to ask for a copy of your data, to
          have it corrected or deleted, to object to how it is used, or to have it sent elsewhere.
        </p>
        <p>
          For an agency account, write to us. For renter records, ask the agency that holds them —
          they are the controller, and we will help them answer rather than answering over their
          head.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to this policy">
        <p>
          If this policy changes in a way that matters, we will say so before the change takes
          effect. The date at the top always reflects the current version.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
