import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/workspace/workspace-context'
import type { OrgRole } from '@/types/database'

import { VehicleLimitCounter, VehicleLimitNotice } from './components/VehicleLimit'
import { useCreateVehicle, useRestoreVehicle } from './queries'
import { emptyVehicleForm, type VehicleFormValues } from './schemas'

/**
 * What an agency is told when the DATABASE refuses a vehicle over the limit.
 *
 * The trigger's refusal is reachable with Add and Import both hidden: Return to
 * fleet on an archived vehicle, a second tab, or a counter inside its 30s
 * staleTime. It used to be worded by `toAppError`, which has no agency context,
 * so it fell into the branch written for a bespoke limit -- the error said
 * "Your agency's limit is 5 vehicles ... contact us to raise it" while the page
 * behind it said "Starter covers 5 vehicles ... Upgrade to Pro". One fact, two
 * sentences, and the error sent an owner to a support mailbox instead of to
 * Billing.
 *
 * Every assertion here compares the refusal with the sentence the Vehicles page
 * is rendering at the same moment, so the two cannot drift apart again.
 */

interface LimitRow {
  vehicle_limit: number | null
  vehicle_count: number
  tier: string | null
}

const backend = vi.hoisted(() => ({
  /** null stands for "the limit query has not answered yet". */
  limitRow: null as LimitRow | null,
  /** Exactly what the trigger raises, errcode 55000. */
  refusal: { code: '55000', message: 'Your plan covers 5 vehicles. You have 5.' },
}))

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => ({
    rpc: (name: string) => {
      if (name !== 'vehicle_limit_status') return Promise.resolve({ data: null, error: null })
      if (backend.limitRow === null) return new Promise(() => {})
      return Promise.resolve({ data: [backend.limitRow], error: null })
    },
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({ data: null, error: backend.refusal }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: backend.refusal }) }),
    }),
  }),
}))

function workspace(role: OrgRole): WorkspaceContextValue {
  return {
    status: 'ready',
    memberships: [],
    organization: { id: 'org-1', locale: 'en-US', name: 'Agency' } as never,
    membership: null,
    role,
    billingAccessState: 'normal',
    error: null,
    switchOrganization: () => undefined,
    refresh: () => Promise.resolve(),
  }
}

const messages: string[] = []

/** The Vehicles page in miniature: the same counter, notice and two mutations. */
function Harness() {
  const create = useCreateVehicle()
  const restore = useRestoreVehicle('vehicle-1')
  const values = emptyVehicleForm('USD') as unknown as VehicleFormValues

  return (
    <>
      <VehicleLimitCounter />
      <VehicleLimitNotice />
      <button
        type="button"
        onClick={() => {
          create.mutateAsync(values).catch((error: Error) => messages.push(error.message))
        }}
      >
        add
      </button>
      <button
        type="button"
        onClick={() => {
          restore.mutateAsync().catch((error: Error) => messages.push(error.message))
        }}
      >
        return to fleet
      </button>
    </>
  )
}

function renderAs(role: OrgRole) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <WorkspaceContext.Provider value={workspace(role)}>
        <MemoryRouter>
          <Harness />
        </MemoryRouter>
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  )
}

async function refuse(name: 'add' | 'return to fleet'): Promise<string> {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name }))
  await waitFor(() => expect(messages).toHaveLength(1))
  return messages[0]!
}

const OWNER_SENTENCE =
  'Starter covers 5 vehicles. You have 5. Upgrade to Pro for 20 vehicles, or retire one you no longer rent.'

beforeEach(() => {
  messages.length = 0
  backend.limitRow = { vehicle_limit: 5, vehicle_count: 5, tier: 'starter' }
  backend.refusal = { code: '55000', message: 'Your plan covers 5 vehicles. You have 5.' }
})

describe('the database refusal and the Vehicles page', () => {
  it('tells an owner adding a sixth vehicle exactly what the page says', async () => {
    renderAs('owner')
    // The page's own sentence, on screen, at the same moment.
    expect(await screen.findByText(OWNER_SENTENCE)).toBeTruthy()

    expect(await refuse('add')).toBe(OWNER_SENTENCE)
  })

  it('says the same when an archived vehicle is returned to a full fleet', async () => {
    renderAs('owner')
    expect(await screen.findByText(OWNER_SENTENCE)).toBeTruthy()

    expect(await refuse('return to fleet')).toBe(OWNER_SENTENCE)
  })

  // The sentence this replaces. An agency on Starter has no bespoke limit, and
  // a support mailbox is not where an owner should be sent for one click.
  it('never claims a bespoke limit nor routes an owner to support', async () => {
    renderAs('owner')
    await screen.findByText(OWNER_SENTENCE)

    const message = await refuse('add')
    expect(message).not.toMatch(/agency's limit/i)
    expect(message).not.toMatch(/contact us/i)
    // Nor the database's own wording, which reads "covers 1 vehicles" at one.
    expect(message).not.toMatch(/plan covers 5 vehicles\. You have 5\./)
  })

  it('tells a manager to ask the owner, as the page does', async () => {
    const sentence =
      'Starter covers 5 vehicles. You have 5. Retire one you no longer rent, or ask the owner to upgrade.'
    renderAs('manager')
    expect(await screen.findByText(sentence)).toBeTruthy()

    expect(await refuse('add')).toBe(sentence)
  })

  // An agency that really does hold an override: the bespoke sentence is the
  // true one, and the page and the refusal agree on that too.
  it('keeps the bespoke wording when the limit is not the tier allowance', async () => {
    backend.limitRow = { vehicle_limit: 150, vehicle_count: 150, tier: 'starter' }
    backend.refusal = { code: '55000', message: 'Your plan covers 150 vehicles. You have 150.' }
    const sentence =
      "Your agency's limit is 150 vehicles. You have 150. Retire one you no longer rent, or contact us to raise it."
    renderAs('owner')
    expect(await screen.findByText(sentence)).toBeTruthy()

    expect(await refuse('add')).toBe(sentence)
  })

  /*
   * The counter is inside its 30s staleTime and still reads 4 of 5 while the
   * server has just refused the fifth-plus-one. The numbers in the sentence are
   * the SERVER's; only the tier comes from the cache. Reading the count from the
   * cache instead would drop this to the neutral sentence.
   */
  it('words the refusal with the numbers the server compared, not the stale ones', async () => {
    backend.limitRow = { vehicle_limit: 5, vehicle_count: 4, tier: 'starter' }
    renderAs('owner')
    // Below the limit, so the page itself says nothing yet.
    expect(await screen.findByText('4 of 5')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()

    expect(await refuse('add')).toBe(OWNER_SENTENCE)
  })

  /*
   * Nothing is cached yet, so there is no tier to name. The sentence then names
   * neither a tier nor a bespoke limit, and still points at the thing that fixes
   * it rather than at a support mailbox.
   */
  it('falls back to a tier-neutral sentence before the limit has loaded', async () => {
    backend.limitRow = null
    renderAs('owner')

    const message = await refuse('add')
    expect(message).toBe(
      'Your plan covers 5 vehicles and you have 5. Retire one you no longer rent, or see Billing to move up.',
    )
    expect(message).not.toMatch(/contact us/i)
    expect(message).not.toMatch(/agency's limit/i)
  })
})
