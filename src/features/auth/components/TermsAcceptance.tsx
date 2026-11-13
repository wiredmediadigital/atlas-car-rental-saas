import { type ComponentProps, useId } from 'react'
import { Link } from 'react-router-dom'

import { paths } from '@/app/routes/paths'

export type TermsAcceptanceProps = Omit<ComponentProps<'input'>, 'type' | 'id'> & {
  error?: string | undefined
}

/**
 * The one thing a person agrees to before an account exists.
 *
 * TWO VERBS, DELIBERATELY. You agree to a contract; you are informed by a
 * privacy notice. "I accept the Privacy Policy" bundles consent to a document
 * that is not asking for consent, which weakens both and muddies the lawful
 * basis the notice relies on. The sentence is therefore split, and should stay
 * split.
 *
 * The links are ordinary in-app links, in the same tab. A person about to agree
 * to a liability cap is entitled to read it without the product deciding how
 * their browser should behave, and the back button brings them straight back to
 * a form that has kept everything they typed.
 *
 * The input and its label are siblings rather than nested, so clicking either
 * link opens the document instead of quietly toggling the box.
 */
export function TermsAcceptance({ error, className, ...inputProps }: TermsAcceptanceProps) {
  const id = useId()
  const errorId = error ? `${id}-error` : undefined

  return (
    <div className={className}>
      <div className="flex items-start gap-2.5">
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className="accent-brand-600 mt-0.5 size-4 shrink-0 rounded"
          {...inputProps}
        />
        <label htmlFor={id} className="text-ink text-[0.8125rem] leading-5">
          I agree to the{' '}
          <Link to={paths.terms} className="text-brand-700 font-medium hover:underline">
            Terms of Service
          </Link>{' '}
          and have read the{' '}
          <Link to={paths.privacy} className="text-brand-700 font-medium hover:underline">
            Privacy Policy
          </Link>
          .
        </label>
      </div>
      {error ? (
        <p id={errorId} className="text-critical-600 mt-1.5 text-[0.75rem] leading-4 font-medium">
          {error}
        </p>
      ) : null}
    </div>
  )
}
