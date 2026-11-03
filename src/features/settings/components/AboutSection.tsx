import { ArrowUpRight } from 'lucide-react'

import { Card, CardBody, CardHeader } from '@/components/ui'
import { CreatorCredit } from '@/components/brand/CreatorCredit'
import { PRODUCT_BRAND } from '@/lib/config/brand'
import { getAppName } from '@/lib/config/env'

/**
 * What this software is, which build it is, and who wrote it.
 *
 * The one screen inside the product where the publisher is named at length, and
 * it is deliberately here rather than in the chrome: somebody who wants to know
 * what they are running will look in Settings, and everybody else runs their
 * agency without being reminded whose software it is.
 *
 * Nothing on this page is about the agency. The agency's own identity — its
 * name, logo, address and contract wording — lives in the sections above, and
 * that separation is the whole point: this says who made the tool, those say who
 * the business is, and only the latter reaches a renter.
 */
export function AboutSection() {
  const appName = getAppName()
  const isRenamed = appName !== PRODUCT_BRAND.name

  return (
    <Card>
      <CardHeader
        title={`About ${appName}`}
        description="What this software is, and which build you are running."
      />
      <CardBody>
        <dl className="divide-line divide-y">
          <Row label="Product">
            {/*
              A deployment may rename the running application. When it has, both
              names are shown: hiding the original would make the version number
              below unmatchable to anything.
            */}
            <span className="text-ink font-medium">
              {isRenamed ? `${appName} (${PRODUCT_BRAND.fullName})` : PRODUCT_BRAND.fullName}
            </span>
          </Row>

          <Row label="Version">
            <span data-numeric="" className="identifier text-ink">
              {__APP_VERSION__}
            </span>
          </Row>

          <Row label="Created by">
            <CreatorCredit className="text-brand-700 hover:text-brand-600 inline-flex items-center gap-1 font-medium underline underline-offset-2">
              {PRODUCT_BRAND.creator}
              {PRODUCT_BRAND.creatorUrl === null ? null : (
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              )}
            </CreatorCredit>
          </Row>
        </dl>

        {/*
          WHAT THIS PARAGRAPH NO LONGER SAYS, AND WHY.

          It used to read "Free to use, with every module unlocked. Your
          agency's records, documents and contracts are yours — <publisher> has
          no access to them and does not appear on anything you issue to a
          customer."

          Both halves were true of the arrangement this software was written
          for: it was given away, and the recipient ran their own Supabase
          project, so the publisher genuinely could not see anything. Neither
          survives being run as a hosted service. Agencies are now tenants in
          one project that the publisher operates and holds the service role
          key for, which means the publisher CAN read their records; and the
          product is sold on a trial and a subscription, so it is not free.

          A claim about who can see a customer's data is not product copy. If
          something needs saying about it, it belongs in a privacy policy that
          someone qualified has written and the business can stand behind — not
          in a sentence that a rename can quietly invert.

          What is left is the part that is still true and still useful: the
          documents a renter receives carry the agency's identity, which is
          configured in the sections above this one.
        */}
        <p className="text-ink-subtle border-line mt-5 border-t pt-4 text-[0.75rem] leading-5">
          Your agency&rsquo;s own name, logo and contract wording are what appear on the documents
          you issue. Set them in the sections above.
        </p>
      </CardBody>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
      <dt className="text-ink-muted text-[0.8125rem]">{label}</dt>
      <dd className="min-w-0 text-[0.8125rem]">{children}</dd>
    </div>
  )
}
