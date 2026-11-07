import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { helpArticlePath, paths } from '@/app/routes/paths'
import { PageHeader, ToastProvider } from '@/components/ui'
import { Sidebar } from '@/components/layout/Sidebar'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { MarketingFooter } from '@/pages/marketing/components/MarketingFooter'
import { AcceptInvitePage } from '@/pages/auth/AcceptInvitePage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'

import type { HelpPage } from './types'

/*
 * Which help pages "exist" is controlled here rather than read from the real
 * content, because the gate is the thing under test and the real answer changes
 * as pages are written. A test that depended on the real set would either pass
 * vacuously or break every time a page landed. `route-topics.test.ts` covers
 * the real content.
 */
const existing = vi.hoisted(() => new Set<string>())

vi.mock('./content', () => ({
  getHelpPage: (slug: string) =>
    existing.has(slug) ? ({ slug, frontMatter: {}, body: '' } as unknown as HelpPage) : undefined,
  loadHelpPages: () => [],
}))

vi.mock('@/features/workspace/workspace-context', () => ({
  useWorkspace: () => ({
    organization: null,
    memberships: [],
    role: null,
    switchOrganization: vi.fn(),
  }),
}))
vi.mock('@/features/notifications/components/NotificationBell', () => ({
  NotificationBell: () => null,
}))
vi.mock('@/components/layout/UserMenu', () => ({ UserMenu: () => null }))
vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ status: 'unauthenticated', user: null, signOut: vi.fn() }),
}))
vi.mock('@/features/team/queries', () => ({
  useAcceptInvitation: () => ({ mutate: vi.fn() }),
}))

beforeEach(() => {
  existing.clear()
})

function inRouter(ui: React.ReactNode, at = '/') {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('the sidebar footer', () => {
  it('links to the help centre', () => {
    inRouter(<Sidebar isCollapsed={false} />)
    expect(screen.getByRole('link', { name: 'Help centre' })).toHaveAttribute('href', paths.help)
  })

  it('keeps the help link, as an icon with a name, when collapsed', () => {
    inRouter(<Sidebar isCollapsed />)
    const link = screen.getByRole('link', { name: 'Help centre' })
    expect(link).toHaveAttribute('href', paths.help)
    expect(link).not.toHaveTextContent('Help centre')
    expect(link).toHaveAttribute('title', 'Help centre')
  })
})

describe('PageHeader', () => {
  it('renders a help link for a route that maps to a help page', () => {
    existing.add('rentals')
    inRouter(<PageHeader title="Rentals" />, paths.rentals)
    expect(screen.getByRole('link', { name: /help/i })).toHaveAttribute(
      'href',
      helpArticlePath('rentals'),
    )
  })

  it('also renders it on a detail route that inherits its module page', () => {
    existing.add('rentals')
    inRouter(<PageHeader title="Rental" />, '/rentals/abc-123')
    expect(screen.getByRole('link', { name: /help/i })).toHaveAttribute(
      'href',
      helpArticlePath('rentals'),
    )
  })

  it('renders no help link on a route whose help page does not exist', () => {
    // Mapped to a slug, but no such page: linking would be a 404.
    inRouter(<PageHeader title="Vehicles" />, paths.vehicles)
    expect(screen.queryByRole('link', { name: /help/i })).toBeNull()
  })

  it('renders no help link on a route that maps to nothing', () => {
    existing.add('rentals')
    inRouter(<PageHeader title="Elsewhere" />, '/nowhere')
    expect(screen.queryByRole('link', { name: /help/i })).toBeNull()
  })

  it('keeps its own actions beside the help link', () => {
    existing.add('rentals')
    inRouter(<PageHeader title="Rentals" actions={<button>New rental</button>} />, paths.rentals)
    expect(screen.getByRole('button', { name: 'New rental' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /help/i })).toBeInTheDocument()
  })

  it('renders without a router, as it did before it knew about help', () => {
    existing.add('rentals')
    render(<PageHeader title="Anywhere" actions={<button>Act</button>} />)
    expect(screen.getByRole('heading', { name: 'Anywhere' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /help/i })).toBeNull()
  })

  it('renders no action row at all when there is nothing to put in it', () => {
    const { container } = inRouter(<PageHeader title="Vehicles" />, paths.vehicles)
    expect(container.querySelector('header > div:nth-of-type(2)')).toBeNull()
  })
})

describe('the marketing footer', () => {
  it('links to the help centre', () => {
    inRouter(<MarketingFooter />)
    expect(screen.getByRole('link', { name: 'Help centre' })).toHaveAttribute('href', paths.help)
  })
})

describe('the invitation and reset screens', () => {
  const slug = 'accept-your-invitation'
  const resetSlug = 'troubleshooting'

  it('link to the invitation help page when it exists', () => {
    existing.add(slug)
    inRouter(<AcceptInvitePage />)
    expect(screen.getByRole('link', { name: /help/i })).toHaveAttribute(
      'href',
      helpArticlePath(slug),
    )
  })

  it('show no help link while the invitation help page does not exist', () => {
    inRouter(<AcceptInvitePage />)
    expect(screen.queryByRole('link', { name: /help/i })).toBeNull()
  })

  it('give the reset screen the troubleshooting page, and only that page', () => {
    const first = inRouter(<ResetPasswordPage />)
    expect(screen.queryByRole('link', { name: /help/i })).toBeNull()
    first.unmount()

    // The invitation page existing is not enough: it is the wrong page here.
    existing.add(slug)
    const second = inRouter(<ResetPasswordPage />)
    expect(screen.queryByRole('link', { name: /help/i })).toBeNull()
    second.unmount()

    existing.add(resetSlug)
    inRouter(<ResetPasswordPage />)
    expect(screen.getByRole('link', { name: /help/i })).toHaveAttribute(
      'href',
      helpArticlePath(resetSlug),
    )
  })

  it('AuthLayout renders no help link unless asked for one', () => {
    existing.add(slug)
    inRouter(<AuthLayout title="Plain">body</AuthLayout>)
    expect(screen.queryByRole('link', { name: /help/i })).toBeNull()
  })
})
