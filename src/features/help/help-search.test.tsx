import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { AppRouter } from '@/app/routes/AppRouter'
import { helpArticlePath } from '@/app/routes/paths'

import { loadHelpPages } from './content'
import { HELP_NAVIGATION } from './navigation'
import { searchHelp } from './search'

/*
 * As in help-routing.test.tsx, the whole `AppRouter` is rendered with no
 * providers, so a guard leaking over a help route fails these. Expectations are
 * derived from the content and the navigation tree, never from how many pages
 * exist today.
 */

/** The help routes are lazy chunks; under a loaded full-suite run the first paint can outlast the 1s default. */
const ROUTE_LOAD = { timeout: 10_000 }

beforeAll(async () => {
  // Warm the lazy page chunks under the generous hook timeout, so a loaded
  // full-suite run spends its cold transform here rather than inside a test.
  await import('@/pages/help/HelpIndexPage')
  await import('@/pages/help/HelpArticlePage')
})

function visit(path: string) {
  window.history.pushState({}, '', path)
  return render(<AppRouter />)
}

afterEach(() => {
  window.history.pushState({}, '', '/')
})

const FIRST_PAGE = loadHelpPages()[0]
const LISTED_SLUGS = HELP_NAVIGATION.flatMap((entry) => entry.slugs)

describe('help search', () => {
  it('labels the search input for screen readers', async () => {
    visit('/help')

    expect(
      await screen.findByRole('searchbox', { name: 'Search help' }, ROUTE_LOAD),
    ).toBeInTheDocument()
  })

  it.each(['/help', '/help/nonsense', `/help/${FIRST_PAGE?.slug}`])(
    'is available at %s',
    async (path) => {
      visit(path)

      expect(
        await screen.findByRole('searchbox', { name: 'Search help' }, ROUTE_LOAD),
      ).toBeInTheDocument()
    },
  )

  it('lists matching pages as links when a query is typed', async () => {
    const user = userEvent.setup()
    visit('/help')
    const title = FIRST_PAGE?.frontMatter.title ?? ''
    const expected = searchHelp(title)
    expect(expected.length).toBeGreaterThan(0)

    await user.type(
      await screen.findByRole('searchbox', { name: 'Search help' }, ROUTE_LOAD),
      title,
    )

    const results = await screen.findByRole('list', { name: 'Search results' })
    for (const result of expected) {
      expect(within(results).getByRole('link', { name: new RegExp(result.title) })).toHaveAttribute(
        'href',
        helpArticlePath(result.slug),
      )
    }
    expect(within(results).getAllByRole('link')).toHaveLength(expected.length)
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    visit('/help')

    await user.type(
      await screen.findByRole('searchbox', { name: 'Search help' }, ROUTE_LOAD),
      'qqzzxx',
    )

    expect(await screen.findByText(/no help pages match/i)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
  })

  it('shows no results for a single character', async () => {
    const user = userEvent.setup()
    visit('/help')

    await user.type(await screen.findByRole('searchbox', { name: 'Search help' }, ROUTE_LOAD), 'r')

    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
    expect(screen.queryByText(/no help pages match/i)).not.toBeInTheDocument()
  })

  it('clears the query with Escape', async () => {
    const user = userEvent.setup()
    visit('/help')
    const input = await screen.findByRole('searchbox', { name: 'Search help' }, ROUTE_LOAD)

    await user.type(input, FIRST_PAGE?.frontMatter.title ?? '')
    await user.keyboard('{Escape}')

    expect(input).toHaveValue('')
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
  })

  it('opens a result and clears the search', async () => {
    const user = userEvent.setup()
    visit('/help')
    const page = FIRST_PAGE
    const input = await screen.findByRole('searchbox', { name: 'Search help' }, ROUTE_LOAD)

    await user.type(input, page?.frontMatter.title ?? '')
    const results = await screen.findByRole('list', { name: 'Search results' })
    await user.click(within(results).getAllByRole('link')[0] as HTMLElement)

    expect(window.location.pathname).toMatch(/^\/help\//)
    expect(await screen.findByRole('searchbox', { name: 'Search help' }, ROUTE_LOAD)).toHaveValue(
      '',
    )
  })
})

/*
 * Below `lg` the sidebar is hidden, so without this a phone reader had no way
 * to reach any other help page. The tree lives in a dialog, which is not
 * mounted until opened — so on desktop there is exactly one "Help pages"
 * landmark, the sidebar's.
 */
describe('help navigation on a small screen', () => {
  it.each(['/help', '/help/nonsense', `/help/${LISTED_SLUGS[0]}`])(
    'opens the page tree from %s',
    async (path) => {
      const user = userEvent.setup()
      visit(path)

      await user.click(
        await screen.findByRole('button', { name: 'Open help navigation' }, ROUTE_LOAD),
      )

      const dialog = await screen.findByRole('dialog', { name: 'Help navigation' }, ROUTE_LOAD)
      const tree = within(dialog).getByRole('navigation', { name: 'Help pages' })
      for (const slug of LISTED_SLUGS) {
        expect(
          within(tree)
            .getAllByRole('link')
            .some((link) => link.getAttribute('href') === helpArticlePath(slug)),
        ).toBe(true)
      }
    },
  )

  it('renders no second "Help pages" landmark until the menu is opened', async () => {
    visit(`/help/${LISTED_SLUGS[0]}`)
    await screen.findByRole('button', { name: 'Open help navigation' }, ROUTE_LOAD)

    expect(screen.getAllByRole('navigation', { name: 'Help pages' })).toHaveLength(1)
  })

  it('is operable from the keyboard and closes with Escape', async () => {
    const user = userEvent.setup()
    visit('/help')
    const trigger = await screen.findByRole('button', { name: 'Open help navigation' }, ROUTE_LOAD)

    trigger.focus()
    await user.keyboard('{Enter}')
    expect(
      await screen.findByRole('dialog', { name: 'Help navigation' }, ROUTE_LOAD),
    ).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes after a page is chosen and lands on it', async () => {
    const user = userEvent.setup()
    visit('/help/nonsense')
    await user.click(
      await screen.findByRole('button', { name: 'Open help navigation' }, ROUTE_LOAD),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Help navigation' }, ROUTE_LOAD)

    await user.click(within(dialog).getAllByRole('link', { name: /./ })[0] as HTMLElement)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
