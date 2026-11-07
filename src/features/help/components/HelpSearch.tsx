import { Search } from 'lucide-react'
import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import { helpArticlePath } from '@/app/routes/paths'

import { searchHelp } from '../search'

/**
 * The help search box and its results.
 *
 * A plain labelled input over a list of links rather than an ARIA combobox:
 * the results are ordinary links in the tab order, so a keyboard or
 * screen-reader reader needs no widget behaviour to reach them.
 */
export function HelpSearch() {
  const [query, setQuery] = useState('')
  const inputId = useId()
  const results = searchHelp(query)
  const hasQuery = query.trim().length >= 2

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') setQuery('')
  }

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-sm">
      <label htmlFor={inputId} className="sr-only">
        Search help
      </label>
      <Search
        className="text-ink-subtle pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search help"
        autoComplete="off"
        className="border-line bg-surface text-ink placeholder:text-ink-subtle h-9 w-full rounded-md border ps-9 pe-3 text-sm"
      />

      {hasQuery ? (
        <div className="border-line bg-surface absolute inset-x-0 top-full z-50 mt-2 max-h-[70dvh] min-w-64 overflow-y-auto rounded-lg border p-2 shadow-raised sm:min-w-96">
          {results.length > 0 ? (
            <ul aria-label="Search results" className="space-y-0.5">
              {results.map((result) => (
                <li key={result.slug}>
                  <Link
                    to={helpArticlePath(result.slug)}
                    onClick={() => setQuery('')}
                    className="hover:bg-surface-inset block rounded-md px-3 py-2"
                  >
                    <span className="text-ink block text-sm font-medium">{result.title}</span>
                    <span className="text-ink-muted mt-0.5 block text-xs leading-5">
                      {result.excerpt}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-muted px-3 py-2 text-sm">
              No help pages match “{query.trim()}”.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
