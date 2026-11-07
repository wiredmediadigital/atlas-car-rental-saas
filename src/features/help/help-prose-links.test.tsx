import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { HelpMarkdown } from './components/HelpMarkdown'

/*
 * Prose is the only place in the Help Centre that was still navigating by
 * document load. The sidebar, the index cards and the search results all route
 * through react-router; a link inside a paragraph reloaded the page and re-ran
 * the whole app bootstrap to reach a route the router already had.
 *
 * These are the three shapes that must keep behaving differently: an in-site
 * help route, which the router now owns, and the fragment and `mailto:` hrefs,
 * which belong to the browser and must be left exactly alone.
 */
/** Shows where the router currently is, so a test can prove it did not move. */
function Whereabouts() {
  const location = useLocation()
  return <output data-testid="whereabouts">{`${location.pathname}${location.hash}`}</output>
}

function renderProse(body: string) {
  return render(
    <MemoryRouter initialEntries={['/help/calendar']}>
      <Whereabouts />
      <Routes>
        <Route path="/help/calendar" element={<HelpMarkdown body={body} sections={[]} />} />
        <Route path="/help/rentals" element={<p>The rentals page.</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function whereabouts() {
  return screen.getByTestId('whereabouts').textContent
}

describe('links inside help prose', () => {
  it('navigates to another help page without reloading the document', async () => {
    const user = userEvent.setup()
    renderProse('See [Rentals](/help/rentals) for the rest.')

    await user.click(screen.getByRole('link', { name: 'Rentals' }))

    expect(screen.getByText('The rentals page.')).toBeVisible()
  })

  it('leaves a fragment anchor to the browser', async () => {
    const user = userEvent.setup()
    renderProse('Jump to [the charges](#charges-and-money).')

    const link = screen.getByRole('link', { name: 'the charges' })
    // A router `Link` would have resolved this against the current route and,
    // on click, moved the router rather than letting the browser scroll.
    expect(link).toHaveAttribute('href', '#charges-and-money')
    expect(link).not.toHaveAttribute('target')

    await user.click(link)

    expect(whereabouts()).toBe('/help/calendar')
  })

  it('leaves a mailto: href to the mail client', async () => {
    const user = userEvent.setup()
    renderProse('Write to [support](mailto:support@example.com).')

    const link = screen.getByRole('link', { name: 'support' })
    expect(link).toHaveAttribute('href', 'mailto:support@example.com')
    expect(link).not.toHaveAttribute('target')

    // A router `Link` would have treated this as a route and navigated to it.
    await user.click(link)

    expect(whereabouts()).toBe('/help/calendar')
  })

  it('keeps an external link an anchor, in a new tab, with rel set', () => {
    renderProse('Read [the guide](https://example.com/guide).')

    const link = screen.getByRole('link', { name: 'the guide' })
    expect(link).toHaveAttribute('href', 'https://example.com/guide')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('routes the Help Centre index too', async () => {
    const user = userEvent.setup()
    renderProse('Back to [the Help Centre](/help).')

    await user.click(screen.getByRole('link', { name: 'the Help Centre' }))

    expect(whereabouts()).toBe('/help')
  })
})
