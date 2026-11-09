import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PageHeader } from '@/components/ui'

import { VehicleLimitCounter, VehicleLimitNotice } from './components/VehicleLimit'
import { downgradeRefusalCopy, vehicleLimitCopy, type VehicleLimitStatus } from './limit'

const state = vi.hoisted(() => ({
  status: undefined as { limit: number | null; count: number; tier: string | null } | undefined,
  canManageBilling: false,
}))

vi.mock('./queries', () => ({
  useVehicleLimit: () => ({ data: state.status }),
}))

vi.mock('@/features/workspace/workspace-context', () => ({
  usePermission: (permission: string) => permission === 'billing.manage' && state.canManageBilling,
}))

const STARTER_FULL: VehicleLimitStatus = { limit: 5, count: 5, tier: 'starter' }

beforeEach(() => {
  state.status = STARTER_FULL
  state.canManageBilling = false
})

function renderAt(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('the counter', () => {
  it('shows "5 of 5" beside the heading', () => {
    renderAt(<PageHeader title="Vehicles" titleAddon={<VehicleLimitCounter />} />)

    const heading = screen.getByRole('heading', { name: 'Vehicles' })
    expect(within(heading.parentElement!).getByText('5 of 5')).toBeTruthy()
  })

  it('shows the count from day one, not only at the ceiling', () => {
    state.status = { limit: 20, count: 2, tier: 'pro' }
    renderAt(<VehicleLimitCounter />)
    expect(screen.getByText('2 of 20')).toBeTruthy()
  })

  it('hides the counter when there is no limit', () => {
    state.status = { limit: null, count: 7, tier: null }
    const { container } = renderAt(<VehicleLimitCounter />)
    expect(container.textContent).toBe('')
  })
})

describe('what the limit says', () => {
  it('tells an owner to upgrade and offers the button', () => {
    state.canManageBilling = true
    renderAt(<VehicleLimitNotice />)

    expect(
      screen.getByText(
        'Starter covers 5 vehicles. You have 5. Upgrade to Pro for 20 vehicles, or retire one you no longer rent.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Upgrade' }).getAttribute('href')).toBe('/billing')
  })

  it('tells a staff member to ask an owner or admin, with no button', () => {
    renderAt(<VehicleLimitNotice />)

    const text = screen.getByRole('status').textContent ?? ''
    expect(text.startsWith('Starter covers 5 vehicles. You have 5. ')).toBe(true)
    expect(text).toMatch(/ask an owner or admin to upgrade\.$/)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says nothing while the fleet is below the limit', () => {
    state.canManageBilling = true
    state.status = { limit: 5, count: 4, tier: 'starter' }
    const { container } = renderAt(<VehicleLimitNotice />)
    expect(container.textContent).toBe('')
  })

  it('says nothing when there is no limit', () => {
    state.status = { limit: null, count: 400, tier: null }
    const { container } = renderAt(<VehicleLimitNotice />)
    expect(container.textContent).toBe('')
  })
})

describe('vehicleLimitCopy', () => {
  it('names Pro for 20, never Growth and never the raw key', () => {
    const copy = vehicleLimitCopy({ limit: 5, count: 5, tier: 'starter' }, true)
    expect(copy?.sentence).toContain('Pro for 20 vehicles')
    expect(copy?.sentence).not.toMatch(/growth|starter_|\bstarter\b/)
  })

  it('walks Pro up to Business', () => {
    expect(vehicleLimitCopy({ limit: 20, count: 20, tier: 'pro' }, true)).toEqual({
      sentence:
        'Pro covers 20 vehicles. You have 20. Upgrade to Business for 50 vehicles, or retire one you no longer rent.',
      showUpgradeButton: true,
    })
  })

  it('offers no upgrade from Business, which has nothing above it', () => {
    const copy = vehicleLimitCopy({ limit: 50, count: 50, tier: 'business' }, true)
    expect(copy?.showUpgradeButton).toBe(false)
    expect(copy?.sentence).toContain('Business covers 50 vehicles. You have 50.')
  })

  it("does not call a per-agency limit by the plan's name", () => {
    const copy = vehicleLimitCopy({ limit: 150, count: 150, tier: 'starter' }, true)
    expect(copy?.showUpgradeButton).toBe(false)
    expect(copy?.sentence).toBe(
      "Your agency's limit is 150 vehicles. You have 150. Retire one you no longer rent, or contact us to raise it.",
    )
  })

  it('does not say "1 vehicles"', () => {
    const copy = vehicleLimitCopy({ limit: 1, count: 1, tier: null }, false)
    expect(copy?.sentence).toContain('1 vehicle.')
    expect(copy?.sentence).not.toContain('1 vehicles')
  })
})

describe('downgradeRefusalCopy', () => {
  it('names the gap', () => {
    expect(downgradeRefusalCopy('starter', 5, 12)).toBe(
      'Starter covers 5 vehicles. You have 12. Retire 7 to move down.',
    )
  })

  it('shows a display name for every tier', () => {
    expect(downgradeRefusalCopy('pro', 20, 30)).toMatch(/^Pro covers 20 vehicles/)
    expect(downgradeRefusalCopy('business', 50, 60)).toMatch(/^Business covers 50 vehicles/)
  })
})
