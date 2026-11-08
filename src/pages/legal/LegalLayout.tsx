import type { ReactNode } from 'react'

import { useDocumentMeta } from '@/features/help/useDocumentMeta'
import { MarketingFooter } from '@/pages/marketing/components/MarketingFooter'
import { MarketingHeader } from '@/pages/marketing/components/MarketingHeader'

import { LEGAL } from './legal-config'

interface LegalLayoutProps {
  readonly title: string
  readonly summary: string
  readonly children: ReactNode
}

/**
 * The shell both legal documents share.
 *
 * It wears the marketing header and footer on purpose: these pages are the
 * first thing a cautious buyer opens, and a page that looks detached from the
 * product reads as something bought from a template rather than written about
 * this software.
 *
 * No `MarketingHeader` pricing prop is passed, so no Pricing link appears here.
 * That is deliberate — the link belongs on the page that has the section to
 * scroll to, and an anchor that goes nowhere is the defect the pricing work
 * spent a whole task preventing.
 */
export function LegalLayout({ title, summary, children }: LegalLayoutProps) {
  const legal = LEGAL()
  useDocumentMeta(title, summary)

  return (
    <div className="bg-surface flex min-h-dvh flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-[46rem] px-4 py-16 sm:px-6 lg:px-8">
          <h1 className="text-ink text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="text-ink-muted mt-3 text-[0.9375rem] leading-7">{summary}</p>
          <p className="text-ink-subtle mt-2 text-[0.8125rem]">Last updated {legal.lastUpdated}.</p>

          <div className="mt-10 space-y-10">{children}</div>

          <div className="border-line mt-14 border-t pt-6">
            <p className="text-ink-muted text-[0.875rem] leading-6">
              Questions about this page? Write to{' '}
              <a
                href={`mailto:${legal.contactEmail}`}
                className="text-ink underline underline-offset-2"
              >
                {legal.contactEmail}
              </a>
              .
            </p>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  )
}

/** One numbered section of a legal document. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-ink text-lg font-semibold">{heading}</h2>
      <div className="text-ink-muted space-y-3 text-[0.9375rem] leading-7">{children}</div>
    </section>
  )
}

/** A bulleted list inside a section, styled once so the two documents match. */
export function LegalList({ items }: { items: readonly ReactNode[] }) {
  return (
    <ul className="marker:text-ink-subtle list-disc space-y-2 ps-5">
      {items.map((item, index) => (
        <li key={index} className="ps-1">
          {item}
        </li>
      ))}
    </ul>
  )
}
