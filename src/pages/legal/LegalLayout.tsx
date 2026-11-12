import { Children, isValidElement, type ReactNode } from 'react'

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
 * The id a section is reachable at, so a clause can be linked to directly.
 *
 * Derived from the heading rather than hand-assigned: a document whose
 * anchors are maintained separately from its headings grows anchors that
 * point at the wrong clause, which is worse than having none.
 */
function sectionId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** The headings of the `LegalSection` children, in document order. */
function headingsOf(children: ReactNode): readonly string[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ heading?: unknown }>(child) && typeof child.props.heading === 'string'
      ? [child.props.heading]
      : [],
  )
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
  const headings = headingsOf(children)
  useDocumentMeta(title, summary)

  return (
    <div className="bg-surface flex min-h-dvh flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-[46rem] px-4 py-16 sm:px-6 lg:px-8">
          <h1 className="text-ink text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="text-ink-muted mt-3 text-[0.9375rem] leading-7">{summary}</p>
          <p className="text-ink-subtle mt-2 text-[0.8125rem]">Last updated {legal.lastUpdated}.</p>

          <nav aria-labelledby="contents-heading" className="border-line mt-10 border-t pt-6">
            <h2
              id="contents-heading"
              className="text-ink-subtle text-[0.6875rem] font-semibold tracking-[0.12em] uppercase"
            >
              Contents
            </h2>
            <ol className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {headings.map((heading, index) => (
                <li key={heading} className="flex gap-2.5 text-[0.875rem] leading-6">
                  <span className="text-ink-subtle tabular-nums">{index + 1}.</span>
                  <a
                    href={`#${sectionId(heading)}`}
                    className="text-ink-muted hover:text-ink underline-offset-2 transition-colors hover:underline"
                  >
                    {heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-12 space-y-12 [counter-reset:legal-section]">{children}</div>

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

/**
 * One numbered section of a legal document.
 *
 * The number comes from a CSS counter rather than a prop, so sections cannot
 * drift out of sequence when one is added in the middle — and it sits in the
 * margin, outside the reading column, because it is a reference for citing a
 * clause rather than part of the sentence.
 */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  const id = sectionId(heading)

  return (
    <section
      id={id}
      className="scroll-mt-24 [counter-increment:legal-section] sm:grid sm:grid-cols-[2.5rem_1fr]"
    >
      <span
        aria-hidden="true"
        className="text-ink-subtle hidden pt-1 text-[0.875rem] tabular-nums select-none before:[content:counter(legal-section)_'.'] sm:block"
      />
      <div className="space-y-3">
        <h2 className="text-ink scroll-mt-24 text-lg font-semibold">
          <a
            href={`#${id}`}
            className="before:text-ink-subtle underline-offset-4 before:me-1.5 before:tabular-nums before:[content:counter(legal-section)_'.'] hover:underline sm:before:content-none"
          >
            {heading}
          </a>
        </h2>
        <div className="text-ink-muted space-y-3 text-[0.9375rem] leading-7">{children}</div>
      </div>
    </section>
  )
}

/**
 * A heading one level below a section, for a document long enough that a
 * section has parts of its own. Kept here so all three documents share one
 * type scale rather than each inventing a sub-heading.
 */
export function LegalSubsection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="space-y-2 pt-1">
      <h3 className="text-ink text-[0.9375rem] font-semibold">{heading}</h3>
      <div className="space-y-3">{children}</div>
    </div>
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
