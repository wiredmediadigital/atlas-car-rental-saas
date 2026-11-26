import { beforeEach, describe, expect, it, vi } from 'vitest'

import { emptyVehicleForm, type VehicleFormValues } from './schemas'

/**
 * The invariant that protects stored service dates.
 *
 * `updateVehicle` issues an UPDATE naming every column `toRow` returns, so a
 * column that appears there with a blank value is a column that gets cleared.
 * Preventive servicing moved to Maintenance Management, and the general
 * vehicle form no longer edits `next_service_on` -- but the dates agencies
 * already recorded are history and must survive. The only thing standing
 * between those dates and a silent, one-vehicle-at-a-time wipe is that the key
 * is absent from the payload, so that is what this pins.
 */

type Row = Record<string, unknown>

const single = vi.fn()
const select = vi.fn(() => ({ single }))
const eq = vi.fn((_column: string, _value: string) => ({ select }))
const update = vi.fn((_row: Row) => ({ eq }))
const insert = vi.fn((_row: Row) => ({ select }))
const from = vi.fn((_table: string) => ({ update, insert }))
const rpc = vi.fn((_name: string, _args: { p_rows: Row[] }) => undefined as unknown)

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ from, rpc }) }))

function formValues(): VehicleFormValues {
  return {
    ...emptyVehicleForm('USD'),
    make: 'Kia',
    model: 'Forte',
    registrationPlate: 'DEMO-004',
  } as unknown as VehicleFormValues
}

describe('a general vehicle edit cannot touch the service date', () => {
  beforeEach(() => {
    from.mockClear()
    update.mockClear()
    insert.mockClear()
    single.mockResolvedValue({ data: { id: 'vehicle-1' }, error: null })
  })

  it('omits next_service_on from the update payload entirely', async () => {
    const { updateVehicle } = await import('./api')
    await updateVehicle('vehicle-1', formValues())

    expect(update).toHaveBeenCalledTimes(1)
    const payload = update.mock.calls[0]![0]

    // Not "is null" — absent. A null would clear the stored date.
    expect(payload).not.toHaveProperty('next_service_on')
    // The other renewal dates are still the vehicle form's to own.
    expect(payload).toHaveProperty('insurance_expires_on')
    expect(payload).toHaveProperty('inspection_expires_on')
    expect(payload).toHaveProperty('registration_expires_on')
  })

  it('omits it when creating a vehicle too, leaving the column to its default', async () => {
    const { createVehicle } = await import('./api')
    await createVehicle('org-1', formValues())

    const payload = insert.mock.calls[0]![0]
    expect(payload).not.toHaveProperty('next_service_on')
  })

  it('omits it from an imported row', async () => {
    const { importVehicles } = await import('./api')
    rpc.mockResolvedValue({ data: [{ id: 'v1' }], error: null })

    await importVehicles('org-1', [formValues()])

    const args = rpc.mock.calls[0]![1]
    expect(args.p_rows[0]).not.toHaveProperty('next_service_on')
  })
})
