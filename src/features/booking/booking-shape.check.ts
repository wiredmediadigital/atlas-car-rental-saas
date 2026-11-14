/**
 * Compile-time guard: the browser's copy of the public booking payload must
 * stay identical to the Edge Function's.
 *
 * The three shapes are declared twice for the reason given in
 * `src/features/marketing/pricing-shape.check.ts`: the Edge Functions (Deno)
 * and the Vite app share no module graph, and importing the Deno module from
 * `src/` would drag Deno-targeted code into the browser bundle. The cost of the
 * duplication is drift, and here drift is quiet: the browser parser rejects any
 * payload that does not match its copy, so a renamed field would empty an
 * agency's booking page with no error and no failing runtime test.
 *
 * Both imports are `import type`, so nothing here reaches a bundle or a
 * runtime. Assignability is checked in both directions, so neither side can add
 * a required field the other lacks.
 *
 * Limits: it catches renames and retypes, but NOT optional-field drift — an
 * optional field added to one side stays mutually assignable. A passing check
 * is not proof the two shapes are identical.
 *
 * It is never imported, so it is not part of the bundle, and it is not a
 * tautology: do not delete it as one. If it fails, update both declarations.
 */
import type {
  PublicAgency as FunctionAgency,
  PublicBookingPage as FunctionPage,
  PublicVehicle as FunctionVehicle,
} from '../../../supabase/functions/_shared/public-booking.ts'

import type {
  PublicAgency as BrowserAgency,
  PublicBookingPage as BrowserPage,
  PublicVehicle as BrowserVehicle,
} from './api'

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

export const publicAgencyShapesMatch: MutuallyAssignable<BrowserAgency, FunctionAgency> = true
export const publicVehicleShapesMatch: MutuallyAssignable<BrowserVehicle, FunctionVehicle> = true
export const publicBookingPageShapesMatch: MutuallyAssignable<BrowserPage, FunctionPage> = true
