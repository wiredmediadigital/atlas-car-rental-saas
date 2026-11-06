import type { HelpSection } from '../sections'

export interface OnThisPageProps {
  sections: readonly HelpSection[]
}

/**
 * Jump links to the task sections of the article being read.
 *
 * Renders nothing at all when a page has no task sections, rather than an empty
 * heading over an empty list.
 */
export function OnThisPage({ sections }: OnThisPageProps) {
  if (sections.length === 0) return null

  return (
    <nav aria-label="On this page" className="sticky top-8">
      <p className="eyebrow">On this page</p>
      <ul className="mt-2 space-y-1.5">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="text-ink-muted hover:text-ink block text-xs leading-5 transition-colors"
            >
              {section.heading}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
