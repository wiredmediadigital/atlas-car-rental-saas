import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRouter } from '@/app/routes/AppRouter'
import { helpArticlePath } from '@/app/routes/paths'
import { getHelpPage } from '@/features/help/content'
import { HELP_NAVIGATION } from '@/features/help/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'

/*
 * Rendered through the real `AppRouter` with no providers, like
 * `help-routing.test.tsx`: if `/help` is ever registered inside a guard, the
 * guard's `useAuth` throws and these fail. Assertions read `HELP_NAVIGATION`
 * rather than a literal count, so they hold as Tasks 10 and 11 add pages.
 */

vi.mock('@/lib/supabase/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSupabaseClient: vi.fn(() => {
    throw new Error('The Help Centre must not reach Supabase.')
  }),
}))

async function visitIndex() {
  window.history.pushState({}, '', '/help')
  render(<AppRouter />)
  return screen.findByRole('heading', { level: 1, name: 'Help centre' })
}

afterEach(() => {
  window.history.pushState({}, '', '/')
})

describe('the /help index, signed out', () => {
  it('resolves without a session, a Supabase call or a redirect', async () => {
    await visitIndex()

    expect(window.location.pathname).toBe('/help')
    expect(getSupabaseClient).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('renders one card per navigation group', async () => {
    await visitIndex()

    const groups = HELP_NAVIGATION.filter((entry) => entry.slugs.length > 0)
    expect(groups.length).toBeGreaterThan(0)
    const cards = screen.getAllByRole('region')
    expect(cards).toHaveLength(groups.length)
    for (const entry of groups) {
      expect(screen.getByRole('region', { name: entry.group })).toBeInTheDocument()
    }
  })

  it('lists the page titles of each group in its card', async () => {
    await visitIndex()

    for (const entry of HELP_NAVIGATION) {
      const card = screen.getByRole('region', { name: entry.group })
      const titles = within(card)
        .getAllByRole('link')
        .map((link) => link.textContent)
      const expected = entry.slugs.map((slug) => getHelpPage(slug)?.frontMatter.title)
      expect(titles).toEqual(expected)
    }
  })

  it('links each page title to its help article path', async () => {
    await visitIndex()

    for (const entry of HELP_NAVIGATION) {
      const card = screen.getByRole('region', { name: entry.group })
      for (const slug of entry.slugs) {
        const title = getHelpPage(slug)?.frontMatter.title ?? ''
        expect(within(card).getByRole('link', { name: title })).toHaveAttribute(
          'href',
          helpArticlePath(slug),
        )
      }
    }
  })

  it('links the header "Help centre" back to the index', async () => {
    await visitIndex()

    const header = screen.getByRole('banner')
    expect(within(header).getByRole('link', { name: 'Help centre' })).toHaveAttribute(
      'href',
      '/help',
    )
  })
})
