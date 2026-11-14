import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OrgRole } from '@/types/database'

import { BookingPageCard, UNAVAILABLE_ON_PLAN } from './BookingPageCard'

const updateOrganization = vi.hoisted(() => vi.fn())
const rpc = vi.hoisted(() => vi.fn())
const useOrganization = vi.hoisted(() => vi.fn())
const useRole = vi.hoisted(() => vi.fn())

vi.mock('@/features/workspace/api', () => ({ updateOrganization }))
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ rpc }) }))
vi.mock('@/features/workspace/workspace-context', () => ({ useOrganization, useRole }))

const ORGANIZATION = {
  id: 'org-1',
  name: 'Atlas Cars',
  slug: 'atlas-cars',
  public_booking_enabled: false,
}

interface RenderOptions {
  role?: OrgRole
  enabled?: boolean
  /** Null is the answer for a non-member, and for an agency that does not exist. */
  allowed?: boolean | null
}

function renderCard({ role = 'admin', enabled = false, allowed = true }: RenderOptions = {}) {
  useOrganization.mockReturnValue({ ...ORGANIZATION, public_booking_enabled: enabled })
  useRole.mockReturnValue(role)
  rpc.mockResolvedValue({ data: allowed, error: null })

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BookingPageCard />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  updateOrganization.mockReset()
  rpc.mockReset()
  useOrganization.mockReset()
  useRole.mockReset()
  updateOrganization.mockResolvedValue({ ...ORGANIZATION, public_booking_enabled: true })
})

describe('who may see it', () => {
  it('is hidden from staff and managers', () => {
    // Publishing the fleet and its prices is a decision about the business,
    // not about the day. A control somebody cannot use is noise on a page
    // that is already long.
    for (const role of ['staff', 'manager'] as OrgRole[]) {
      const { container, unmount } = renderCard({ role })
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
  })

  it('is shown to an administrator and an owner', () => {
    for (const role of ['admin', 'owner'] as OrgRole[]) {
      renderCard({ role })
      expect(screen.getAllByText('Public booking page').length).toBeGreaterThan(0)
      screen.getAllByRole('switch').forEach((node) => expect(node).toBeInTheDocument())
    }
  })
})

describe('the link', () => {
  it('shows the public link and copies it', async () => {
    const user = userEvent.setup()
    renderCard({ enabled: true })

    const link = screen.getByText(/\/book\/atlas-cars$/)
    expect(link).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /copy link/i }))

    /*
     * Read back through user-event's own clipboard rather than a hand-rolled
     * stub: setup() installs one, so anything defined before it is replaced
     * and a stub asserted on would never be called.
     */
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toContain('/book/atlas-cars'),
    )
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument()
  })

  it('offers no link while the page is off', () => {
    // There is nothing to copy: the address answers as though it does not
    // exist until the switch is on.
    renderCard({ enabled: false })
    expect(screen.queryByText(/\/book\/atlas-cars$/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument()
  })
})

describe('the plan', () => {
  it('explains why the switch is unavailable on a plan without it', async () => {
    renderCard({ allowed: false })
    expect(await screen.findByText(UNAVAILABLE_ON_PLAN)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('switch')).toBeDisabled())
  })

  it('says nothing about the plan when it is included', async () => {
    renderCard({ allowed: true })
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(screen.queryByText(UNAVAILABLE_ON_PLAN)).not.toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeEnabled()
  })

  it('leaves the switch usable when the entitlement cannot be read', async () => {
    // Null is the answer for an agency somebody is not a verified member of,
    // and for one that does not exist. The entitlement itself fails open, and
    // a paying agency must not lose a feature because a lookup did not answer.
    renderCard({ allowed: null })
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(screen.getByRole('switch')).toBeEnabled()
  })
})

describe('switching it on', () => {
  it('saves the switch', async () => {
    const user = userEvent.setup()
    renderCard({ enabled: false })

    await user.click(screen.getByRole('switch'))
    await waitFor(() =>
      expect(updateOrganization).toHaveBeenCalledWith('org-1', { public_booking_enabled: true }),
    )
  })

  it('says that turning it on publishes nothing by itself', () => {
    renderCard({ enabled: true })
    // Every vehicle is opted in separately and starts hidden: two deliberate
    // acts before a stranger can see a car.
    expect(screen.getByText(/every one starts hidden/i)).toBeInTheDocument()
  })
})
