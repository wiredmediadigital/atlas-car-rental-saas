import { SUPPORT_EMAIL } from '@/features/help/constants'

/**
 * An unknown help slug.
 *
 * Rendered inside `HelpLayout`, never by falling through to the application's
 * own not-found page: that one lives inside the authenticated shell, so a
 * signed-out reader who mistyped a help URL would be bounced to sign in — the
 * worst possible answer for somebody who came here because they could not sign
 * in. The page tree stays alongside, so a wrong address still lands the reader
 * somewhere they can navigate from.
 */
export function HelpNotFound() {
  return (
    <div className="max-w-prose">
      <p className="eyebrow">Help centre</p>
      <h1 className="text-ink mt-3 text-2xl">This help page does not exist</h1>
      <p className="text-ink-muted mt-3 text-sm leading-6">
        The address may have been mistyped, or the page may have been renamed. Every help page is
        listed in the page tree.
      </p>
      <p className="text-ink-muted mt-3 text-sm leading-6">
        Still stuck? Write to{' '}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-brand-700 underline underline-offset-2 hover:no-underline"
        >
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </div>
  )
}
