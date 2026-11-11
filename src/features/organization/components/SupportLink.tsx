import { SUPPORT_EMAIL } from '@/features/help/constants'

/**
 * The one-click route to a person.
 *
 * Purging sooner is deliberately not a button, so it has to be a request, and a
 * request nobody can find the address for is not a route at all. Whoever needs
 * their data gone inside the window is in a hurry by definition.
 */
export function SupportLink() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline underline-offset-2">
      {SUPPORT_EMAIL}
    </a>
  )
}
