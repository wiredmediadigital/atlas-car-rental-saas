import { ChevronDown } from 'lucide-react'

import type { PublicPricing } from '@/features/marketing/api'
import { hasRenderablePricing } from '@/features/marketing/renderable-pricing'

/**
 * The questions an agency owner asks before they will put their business in
 * somebody else's software.
 *
 * Every answer here is a claim about what this product actually does, so each
 * one is kept to something the code can be held to: the isolation is a database
 * policy, the double-booking refusal is an exclusion constraint, the exports
 * and imports are real screens. Marketing copy that outruns the product is a
 * support ticket with a delay on it.
 *
 * Built on <details>, not a JavaScript accordion. It opens before hydration,
 * it is keyboard-operable and announced correctly without a line of ARIA, and
 * it adds nothing to a page whose whole point is to be the lightest route in
 * the application. A visitor deciding whether to trust this software should not
 * wait on a bundle to read why they should.
 */
const QUESTIONS: readonly { readonly q: string; readonly a: string }[] = [
  {
    q: 'Can another agency see my data?',
    a: 'No. Every agency is its own tenant, and the separation is enforced by the database on every single query — not by application code that could one day forget. Someone you invite sees your agency and nothing else, and that holds even if a screen is wrong.',
  },
  {
    q: 'What stops the same car being booked twice?',
    a: 'The database refuses it. Two rentals whose dates overlap on one vehicle cannot both exist, so a double booking cannot be created through the calendar, the rental form, an import, or anything else. It is not a check somebody has to remember to run.',
  },
  {
    q: 'Can I bring my existing fleet and customers in?',
    a: 'Yes. Vehicles, customers and expenses each import from a CSV, with a template you can download and fill in. The file is checked row by row and told back to you before anything is written, so a bad column does not become a bad record.',
  },
  {
    q: 'Can I get my data back out?',
    a: 'Yes, whenever you like. Vehicles, customers, expenses, rentals and every report export to CSV — exactly the rows you are looking at on screen, not a different query that can disagree with them. No export tier and no request to support.',
  },
  {
    q: 'Does it produce the rental contract?',
    a: 'Yes. The contract is generated as a PDF from the rental itself, so it says what the booking says. Each version is kept rather than overwritten, and the renter and the driver are recorded separately — because on plenty of contracts they are not the same person.',
  },
  {
    q: 'Can my staff have limited access?',
    a: 'Yes. You invite people by email, and each role carries its own permissions, so counter staff do not need the keys to your finances. Access is checked on the server as well as hidden in the interface.',
  },
]

/**
 * Only offered when the page has a pricing section to point at (the same
 * `hasRenderablePricing` condition as the section and the nav link). It says
 * that there is pricing and where it is; it states no amount and no trial
 * length, because the section is the one place those come from.
 */
const PRICING_QUESTION: { readonly q: string; readonly a: string } = {
  q: 'What does it cost?',
  a: 'The plans and their prices are listed in the pricing section of this page, exactly as they are charged. Nothing is quoted here, so there is one place to read it and it cannot disagree with your bill.',
}

export interface FaqProps {
  pricing?: PublicPricing
}

export function Faq({ pricing }: FaqProps = {}) {
  const questions = hasRenderablePricing(pricing) ? [...QUESTIONS, PRICING_QUESTION] : QUESTIONS

  return (
    <section aria-labelledby="faq-heading" className="border-line border-t">
      <div className="mx-auto max-w-[1220px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <p className="text-ink-subtle text-[0.75rem] font-semibold tracking-[0.08em] uppercase">
              Before you commit
            </p>
            <h2
              id="faq-heading"
              className="text-ink mt-3 text-[1.875rem] font-semibold tracking-tight sm:text-[2.25rem]"
            >
              The questions worth asking first.
            </h2>
            <p className="text-ink-muted mt-4 max-w-sm text-[0.9375rem] leading-6">
              Short answers about your data, your contracts and who can see what.
            </p>
          </div>

          <div className="border-line border-t">
            {questions.map(({ q, a }) => (
              <details key={q} className="border-line group border-b">
                <summary
                  className={[
                    'text-ink flex cursor-pointer list-none items-start justify-between gap-6',
                    'py-5 text-[0.9375rem] font-medium',
                    'hover:text-brand-700 transition-colors',
                    'focus-visible:outline-brand-500 rounded-sm focus-visible:outline-2',
                    'focus-visible:outline-offset-4',
                    '[&::-webkit-details-marker]:hidden',
                  ].join(' ')}
                >
                  {q}
                  <ChevronDown
                    aria-hidden="true"
                    className="text-ink-subtle mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="text-ink-muted max-w-[62ch] pb-5 text-[0.875rem] leading-6">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
