export type IncidentRentalLifecycleOption = {
  readonly id: string
  readonly status: string
  readonly starts_at: string
  readonly ends_at: string
}

/** Returns a rental only when exactly one agreement is currently checked out. */
export function currentCheckedOutRental<T extends IncidentRentalLifecycleOption>(options: readonly T[], now = Date.now()): T | null {
  const matches = options.filter((option) => option.status === 'active' && new Date(option.starts_at).getTime() <= now && new Date(option.ends_at).getTime() > now)
  return matches.length === 1 ? matches[0] ?? null : null
}
