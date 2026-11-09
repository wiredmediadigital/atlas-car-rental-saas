import { beforeEach, describe, expect, it, vi } from 'vitest'

import { importVehicles } from './api'
import { emptyVehicleForm, type VehicleFormValues } from './schemas'

const rpc =
  vi.fn<(name: string, args: { p_organization_id: string; p_rows: object[] }) => unknown>()
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({ rpc }) }))

describe('importVehicles', () => {
  beforeEach(() => rpc.mockReset())

  // Fails if the call goes to a different function, drops the organisation, or
  // sends the form's camelCase shape instead of toRow's snake_case columns.
  it('calls the batch RPC once with snake_case rows', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'v1' }], error: null })
    // The empty form holds strings; the parsed values the dialog sends hold numbers.
    const values = {
      ...emptyVehicleForm('USD'),
      make: 'Toyota',
      registrationPlate: 'AB-1',
    } as unknown as VehicleFormValues

    const result = await importVehicles('org-1', [values])

    expect(rpc).toHaveBeenCalledTimes(1)
    const [name, args] = rpc.mock.calls[0]!
    expect(name).toBe('vehicles_import_batch')
    expect(args.p_organization_id).toBe('org-1')
    expect(args.p_rows[0]).toMatchObject({ make: 'Toyota', registration_plate: 'AB-1' })
    expect(args.p_rows[0]).not.toHaveProperty('registrationPlate')
    expect(args.p_rows[0]).not.toHaveProperty('organization_id')
    expect(result).toEqual([{ id: 'v1' }])
  })

  // Fails if the RPC error is thrown raw: the database sentence would reach the UI.
  it('throws the mapped error, not the raw one', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '55000', message: 'Your plan covers 5 vehicles. You have 5.' },
    })

    await expect(importVehicles('org-1', [])).rejects.toMatchObject({ name: 'AppError' })
    await expect(importVehicles('org-1', [])).rejects.not.toThrow(/plan covers/)
  })
})
