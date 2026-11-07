import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AppRouter } from '@/app/routes/AppRouter'
import { ORG_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/authz/permissions'
import { getSupabaseClient } from '@/lib/supabase/client'

import { getHelpPage } from './content'
import { warmHelpRoutes } from './help-test-support'
import { HelpArticle } from './components/HelpArticle'
import { OnThisPage } from './components/OnThisPage'
import { helpSections } from './sections'
import { resolveTokens } from './tokens'
import type { HelpPage } from './types'

/*
 * Nothing provides a session here — no AppProviders, no AuthContext, no
 * WorkspaceContext. That is the point.
 *
 * `AppRouter` is rendered whole rather than a hand-assembled `MemoryRouter`
 * over the help route, because the guarantee under test is about where the
 * route is *registered*, not about what the page component can do in
 * isolation. Every guard in this router calls `useAuth` or `useWorkspace`,
 * both of which throw without their provider. So if the help route is ever
 * moved inside `RequireAuth`, `WithWorkspace` or `RequireOrganization`, these
 * tests stop passing — which is exactly what should happen.
 */

vi.mock('@/lib/supabase/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSupabaseClient: vi.fn(() => {
    throw new Error('The Help Centre must not reach Supabase.')
  }),
}))

beforeAll(warmHelpRoutes)

function visit(path: string) {
  window.history.pushState({}, '', path)
  return render(<AppRouter />)
}

afterEach(() => {
  window.history.pushState({}, '', '/')
})

describe('a signed-out visitor at /help/rentals', () => {
  it('renders the Rentals article', async () => {
    visit('/help/rentals')

    expect(await screen.findByRole('heading', { level: 1, name: 'Rentals' })).toBeInTheDocument()
    // Read from the page rather than quoted here: what matters is that the
    // article's own summary reaches the screen, not which sentence it is this
    // month. A literal made this assertion a second, silent owner of the prose.
    const summary = getHelpPage('rentals')?.frontMatter.summary ?? ''
    expect(summary).not.toBe('')
    expect(screen.getByText(summary)).toBeInTheDocument()
  })

  it('makes no Supabase auth call while rendering a help article', async () => {
    visit('/help/rentals')
    await screen.findByRole('heading', { level: 1, name: 'Rentals' })

    expect(getSupabaseClient).not.toHaveBeenCalled()
  })

  it('stays on the article instead of being sent to sign in', async () => {
    visit('/help/rentals')
    await screen.findByRole('heading', { level: 1, name: 'Rentals' })

    expect(window.location.pathname).toBe('/help/rentals')
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('renders the breadcrumb group and a link back into the help tree', async () => {
    visit('/help/rentals')
    await screen.findByRole('heading', { level: 1, name: 'Rentals' })

    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByText('Operations')).toBeInTheDocument()
    expect(within(breadcrumb).getByText('Rentals')).toBeInTheDocument()

    const tree = screen.getByRole('navigation', { name: 'Help pages' })
    expect(within(tree).getByRole('link', { name: 'Rentals' })).toHaveAttribute(
      'href',
      '/help/rentals',
    )
  })
})

describe('a signed-out visitor at an unknown help slug', () => {
  it('renders a help-shaped not found for /help/nonsense without redirecting', async () => {
    visit('/help/nonsense')

    expect(
      await screen.findByRole('heading', { level: 1, name: /page does not exist/i }),
    ).toBeInTheDocument()
    // Inside the help layout, not the app's own not-found page: the sidebar is
    // still there, so a reader who mistyped has somewhere to go.
    expect(screen.getByRole('navigation', { name: 'Help pages' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/help/nonsense')
  })
})

/*
 * Section role labels are asserted against a fabricated page rather than
 * `rentals.md`, which is still the Task 1 placeholder and has no task sections.
 * The real prose arrives in Task 10; the rule it has to obey is tested here.
 */
describe('role labels beside task sections', () => {
  const body = [
    '## Delete a rental',
    '<!-- permission: rentals.delete -->',
    '',
    'Only some people may do this.',
    '',
    '## Look up a contract',
    '<!-- permission: rentals.view -->',
    '',
    'Anybody may do this.',
  ].join('\n')

  const page: HelpPage = {
    slug: 'rentals',
    frontMatter: {
      title: 'Rentals',
      group: 'Operations',
      permission: 'rentals.view',
      summary: 'Create, track and close rentals.',
    },
    body,
  }

  it('labels the section whose permission is above staff', async () => {
    render(<HelpArticle page={page} body={body} sections={helpSections(body)} />)

    const heading = await screen.findByRole('heading', { level: 2, name: /Delete a rental/ })
    expect(heading).toHaveTextContent('Manager and above')
  })

  it('leaves a staff-level section unlabelled', async () => {
    render(<HelpArticle page={page} body={body} sections={helpSections(body)} />)

    const heading = await screen.findByRole('heading', { level: 2, name: /Look up a contract/ })
    expect(heading).toHaveTextContent('Look up a contract')
    expect(heading.textContent).toBe('Look up a contract')
  })

  it('never renders the permission comment itself', async () => {
    render(<HelpArticle page={page} body={body} sections={helpSections(body)} />)

    await screen.findByRole('heading', { level: 2, name: /Delete a rental/ })
    expect(document.body.textContent).not.toContain('permission:')
  })
})

/*
 * `{{roleTable}}` is the one token that expands to several lines of Markdown
 * rather than a word, and the Team page publishes the result on a public URL.
 * A token that resolved but failed to parse would put a row of pipe characters
 * in front of every reader without failing anything, so the assertion is that
 * it reaches the DOM as a table — not merely that the text came out.
 *
 * Expectations come from PERMISSIONS' own constants. Typing "Administrator"
 * here would recreate the second copy of the matrix that the token exists to
 * prevent, and it would agree with itself while disagreeing with the product.
 */
describe('the role table a page can embed', () => {
  const tablePage: HelpPage = {
    slug: 'team',
    frontMatter: {
      title: 'Team',
      group: 'Agency',
      permission: 'team.view',
      summary: 'Who can do what.',
    },
    body: '{{roleTable}}',
  }

  function renderTable() {
    const body = resolveTokens(tablePage.body)
    return render(<HelpArticle page={tablePage} body={body} sections={helpSections(body)} />)
  }

  it('renders one row per role, with the matrix label and description', async () => {
    renderTable()

    const table = await screen.findByRole('table')
    // Header row plus one per role.
    expect(within(table).getAllByRole('row')).toHaveLength(ORG_ROLES.length + 1)

    for (const role of ORG_ROLES) {
      expect(within(table).getByRole('cell', { name: ROLE_LABELS[role] })).toBeInTheDocument()
      expect(within(table).getByRole('cell', { name: ROLE_DESCRIPTIONS[role] })).toBeInTheDocument()
    }
  })

  it('leaves no raw token or pipe characters on the page', async () => {
    renderTable()

    await screen.findByRole('table')
    expect(document.body.textContent).not.toContain('{{')
    expect(document.body.textContent).not.toContain('|')
  })
})

/*
 * The anchor on a rendered heading and the anchor `helpSections` reported must
 * be the same string, for every heading, without exception. They used to be
 * computed twice from two different strings — the raw Markdown and the rendered
 * text — and where those disagreed the jump link pointed at nothing and the
 * role label vanished with no error at all.
 *
 * These render the headings that made the two disagree.
 */
describe('heading anchors and labels, for headings that are not plain text', () => {
  function renderBody(body: string) {
    const sections = helpSections(body)
    const page: HelpPage = {
      slug: 'rentals',
      frontMatter: { title: 'Rentals', group: 'Operations', summary: 'Summary.' },
      body,
    }
    render(
      <>
        <HelpArticle page={page} body={body} sections={sections} />
        <OnThisPage sections={sections} />
      </>,
    )
    return sections
  }

  it('anchors a heading that slugs to nothing, and still labels it', async () => {
    const [section] = renderBody('## ?!\n<!-- permission: rentals.delete -->\n\nProse.\n')

    const heading = await screen.findByRole('heading', { level: 2 })
    expect(section?.id).toBe('section-1')
    expect(heading).toHaveAttribute('id', 'section-1')
    expect(heading).toHaveTextContent('Manager and above')
  })

  it('anchors a linked heading under its text, and still labels it', async () => {
    const [section] = renderBody(
      '## [Rentals](/help/rentals)\n<!-- permission: rentals.delete -->\n\nProse.\n',
    )

    const heading = await screen.findByRole('heading', { level: 2 })
    expect(section?.id).toBe('rentals')
    expect(heading).toHaveAttribute('id', 'rentals')
    expect(heading).toHaveTextContent('Manager and above')
  })

  it('points every jump link at an element that is actually on the page', async () => {
    renderBody(
      [
        '## Close a **rental**',
        '<!-- permission: rentals.delete -->',
        '',
        'Prose.',
        '',
        '## ?!',
        '',
        'More prose.',
      ].join('\n'),
    )

    const rail = await screen.findByRole('navigation', { name: 'On this page' })
    const targets = within(rail)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href')?.slice(1))

    // The fallback is positional, so the second section is `section-2` — two
    // unsluggable headings on one page still get two distinct anchors.
    expect(targets).toEqual(['close-a-rental', 'section-2'])
    for (const target of targets) {
      expect(document.getElementById(target ?? '')).not.toBeNull()
    }
  })

  it('anchors and labels a body saved with Windows line endings', async () => {
    // The section lookup is by source line, so this also proves CRLF does not
    // put the parsed line numbers and the rendered ones out of step.
    renderBody('## Delete a rental\r\n<!-- permission: rentals.delete -->\r\n\r\nProse.\r\n')

    const heading = await screen.findByRole('heading', { level: 2 })
    expect(heading).toHaveAttribute('id', 'delete-a-rental')
    expect(heading).toHaveTextContent('Manager and above')
  })

  it('prints the heading in the right rail the way the article prints it', async () => {
    renderBody('## Close a **rental**\n\nProse.\n')

    const rail = await screen.findByRole('navigation', { name: 'On this page' })
    expect(within(rail).getByRole('link')).toHaveTextContent('Close a rental')
    expect(rail.textContent).not.toContain('*')
  })
})
