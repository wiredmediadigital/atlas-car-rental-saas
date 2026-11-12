import { Link } from 'react-router-dom'

import { paths } from '@/app/routes/paths'

import { LegalLayout, LegalList, LegalSection } from './LegalLayout'
import { LEGAL } from './legal-config'

/**
 * The processor terms an agency's own lawyer asks for by name.
 *
 * The privacy policy explains what happens to personal data; this is the
 * contract that obliges us to it. They overlap on purpose — a policy can be
 * rewritten by us at any time, and an agency cannot rely on one as a
 * commitment. Where both describe the same thing, this page is the binding
 * one.
 *
 * Deliberately not stated here: the hosting region and the transfer mechanism
 * for data leaving it. Both are facts about arrangements with providers, not
 * drafting choices, and a DPA that guesses at them is worse than one that
 * sends the reader to a list we actually keep current.
 */
export function DataProcessingPage() {
  const legal = LEGAL()
  const product = legal.productName

  return (
    <LegalLayout
      title="Data processing terms"
      summary={`What ${legal.entityName} may and may not do with the personal data your agency keeps in ${product} — the obligations we take on as your processor.`}
    >
      <LegalSection heading="What this is">
        <p>
          Your agency decides what renter and driver records to collect and why. That makes your
          agency the <strong>controller</strong> of those records. We hold them and act on your
          instructions, which makes us your <strong>processor</strong>. Data protection law requires
          that relationship to be written down, and this is it.
        </p>
        <p>
          These terms form part of the{' '}
          <Link to={paths.terms} className="text-ink underline underline-offset-2">
            terms of service
          </Link>{' '}
          and apply for as long as your agency has an account. Where they and the{' '}
          <Link to={paths.privacy} className="text-ink underline underline-offset-2">
            privacy policy
          </Link>{' '}
          describe the same thing, these terms are the binding ones: a policy is something we can
          rewrite, and you should not have to rely on one as a promise.
        </p>
        <p>
          This page covers only the records your agency puts in. Your own account — who you invited,
          your billing history — is data we decide about ourselves, so we are the controller of it
          and the privacy policy governs it instead.
        </p>
      </LegalSection>

      <LegalSection heading="What we process, and for whom">
        <p>
          <strong>Why.</strong> So that {product} works for you: storing, displaying, searching,
          exporting and deleting your records, generating the documents you ask for, and sending the
          messages you trigger.
        </p>
        <p>
          <strong>For how long.</strong> For as long as your agency has an account, and then as set
          out under &ldquo;Giving it back, and deleting it&rdquo; below.
        </p>
        <p>
          <strong>Whose data.</strong> The renters and drivers your agency records, the people named
          on their documents, and your own staff who use the product.
        </p>
        <p>
          <strong>What kind.</strong> Names and contact details; dates of birth, nationality and
          address; identity and driving documents, including their numbers, issuing country, dates
          and any scan uploaded — passports, national identity cards, residence permits and driving
          licences; rental records, contracts, condition photographs, charges and payments; vehicle
          location data where a GPS provider is connected; and anything written into a free-text
          note.
        </p>
        <p>
          Some of that is sensitive in ordinary terms even where the law does not use that word. We
          treat identity documents and location data as the highest-risk records in the product, and
          the measures below reflect that.
        </p>
      </LegalSection>

      <LegalSection heading="We act only on your instructions">
        <LegalList
          items={[
            'We process your records only as needed to provide the product, and otherwise only when you tell us to — your use of the product is itself the instruction.',
            'We do not read your records, sell them, share them for advertising, or use them to train models. Not as a policy we could change quietly: as a term of this agreement.',
            'If the law compels us to process them some other way, we will tell you before we do, unless the law forbids us from saying so.',
            'If we think an instruction of yours would breach data protection law, we will tell you rather than quietly carry it out.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="Who can see them">
        <p>
          Access is limited to the people who need it to run or support the product, and each of
          them is under a duty of confidentiality that outlasts their time with us. Support staff
          reach your records only when a request from you requires it.
        </p>
      </LegalSection>

      <LegalSection heading="How we keep them safe">
        <p>
          We maintain technical and organisational measures appropriate to the risk. The ones that
          do the most work:
        </p>
        <LegalList
          items={[
            'Every record is scoped to one agency inside the database itself, so one agency cannot read another’s even if a request asks for it. This is enforced below the application, not by the screens.',
            'Every person who signs in must complete two-factor authentication. The requirement is enforced in the database, so a password alone reaches no records at all.',
            'Access within your agency is limited by the role you give each person, and you decide who holds which role.',
            'Uploaded documents are stored privately and opened through links that expire within minutes, so a copied address stops working rather than becoming a passport page on the open internet.',
            'Traffic is encrypted in transit.',
            'Changes to anyone’s second factor are recorded — who did it, to whom, and when.',
          ]}
        />
        <p>
          We may change these measures as the product and the threats to it change, but not in a way
          that materially weakens the protection described here.
        </p>
      </LegalSection>

      <LegalSection heading="Other companies we use">
        <p>
          Running {product} means a small number of providers process your records too. We stay
          responsible for what they do with them, and each is bound by obligations no weaker than
          ours to you.
        </p>
        <p>
          The current list is kept in the{' '}
          <Link to={paths.privacy} className="text-ink underline underline-offset-2">
            privacy policy
          </Link>
          , named individually and with what each one does, rather than described in a category here
          that would go stale. If we add or replace one, we will say so before it starts processing
          your records, and you may object; if we cannot resolve your objection you may close your
          account and we will not charge you for the part of the term you no longer use.
        </p>
        <p>
          Where a provider is outside your country, we put in place a transfer mechanism the law
          recognises before your records reach it. Ask us and we will tell you which applies to
          which provider.
        </p>
      </LegalSection>

      <LegalSection heading="When someone asks you about their data">
        <p>
          A renter&rsquo;s request goes to you, not to us. You are the controller, so you decide
          what to disclose, correct or erase — and only you know the rest of your relationship with
          that person.
        </p>
        <p>
          Our part is to make that answerable. The product lets you find, export, correct and delete
          a renter&rsquo;s records yourself. If a request needs something the product cannot do, ask
          us and we will help, at no charge unless the request is unusually large or repetitive. If
          such a request reaches us directly, we will not answer it ourselves — we will tell the
          person to contact you, and tell you it happened.
        </p>
        <p>
          We will also help, as far as we reasonably can, if you need to assess the risk of a
          security incident, complete a data protection impact assessment, or deal with a regulator.
        </p>
      </LegalSection>

      <LegalSection heading="If something goes wrong">
        <p>
          If personal data we hold for you is lost, exposed or reached by someone who should not
          have it, we will tell you without undue delay after becoming aware of it — not after an
          investigation concludes.
        </p>
        <p>
          We will tell you what we know, which of your records are affected, what the likely
          consequences are, and what we are doing about it, and we will keep telling you as we learn
          more. The clock for notifying your own regulator and the people affected is yours to
          manage, so we will not sit on information while we establish detail.
        </p>
      </LegalSection>

      <LegalSection heading="Giving it back, and deleting it">
        <p>
          You can export your records at any time while you have an account, in a form you can use
          elsewhere. You do not need to ask us, and you do not need to be in good standing — an
          unpaid or closing account can still export.
        </p>
        <LegalList
          items={[
            'When you close your account, the records are kept for a 30-day grace period and then permanently deleted. Throughout that period they stay readable and exportable, and any owner or administrator can restore the account in one click.',
            'If you want them deleted sooner, ask us and we will action it as soon as we reasonably can.',
            'Deletion reaches our providers too, on their own timetables for clearing backups.',
            'We keep nothing of your records afterwards except what the law requires us to keep — billing records for the period tax law demands, and a record that the closure happened and when, with counts of what was removed and never their content.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="Showing you we mean it">
        <p>
          Ask us and we will give you the information you reasonably need to satisfy yourself that
          we are doing what this page says, including answering a security questionnaire.
        </p>
        <p>
          If that is not enough, you may audit us, or have an independent auditor do it: once a
          year, on 30 days&rsquo; notice, at a reasonable time, without disrupting the service or
          exposing another agency&rsquo;s data. You cover the cost unless the audit finds we have
          broken these terms. We will tell you honestly that we are a small company: we would rather
          answer your questions in detail than have you pay for an audit that tells you the same
          thing.
        </p>
      </LegalSection>

      <LegalSection heading="How this sits with the rest">
        <p>
          If these terms and the terms of service conflict about personal data, these win.
          Everything else — what the service does, what it costs, liability, governing law — stays
          as the terms of service sets it out, and the limits on liability there apply to this page
          too.
        </p>
        <p>
          If a change in the law means these terms no longer do their job, we will propose an
          updated version rather than leave you without one.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
