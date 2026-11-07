import { useEffect } from 'react'

import { getAppName } from '@/lib/config/env'

const DESCRIPTION_SELECTOR = 'meta[name="description"]'

/**
 * Puts a help page's title and summary in the browser tab and the description
 * meta tag, and puts back what it found when the page goes away.
 *
 * Restoring matters: the Help Centre lives inside the same single-page app as
 * everything else, so without it a reader who goes from an article back into the
 * app keeps a help title in the tab. The description tag is updated in place
 * rather than appended to — `index.html` already carries one, and two would
 * leave a crawler to pick. If the document has none, one is created and removed
 * again on the way out.
 *
 * Callers pass text that has already had `resolveTokens` applied; this hook
 * adds the product name to the title and nothing else.
 */
export function useDocumentMeta(title: string, description: string): void {
  useEffect(() => {
    const previousTitle = document.title
    const existing = document.head.querySelector<HTMLMetaElement>(DESCRIPTION_SELECTOR)
    const meta = existing ?? document.createElement('meta')
    const previousDescription = existing?.getAttribute('content') ?? null

    if (!existing) {
      meta.setAttribute('name', 'description')
      document.head.appendChild(meta)
    }
    document.title = `${title} | ${getAppName()}`
    meta.setAttribute('content', description)

    return () => {
      document.title = previousTitle
      if (existing && previousDescription !== null) {
        existing.setAttribute('content', previousDescription)
      } else if (existing) {
        existing.removeAttribute('content')
      } else {
        meta.remove()
      }
    }
  }, [title, description])
}
