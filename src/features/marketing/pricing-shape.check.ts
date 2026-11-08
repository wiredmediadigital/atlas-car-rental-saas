/**
 * Compile-time guard: the browser's copy of the public pricing payload must
 * stay identical to the Edge Function's.
 *
 * `PublicPlan` / `PublicPricing` are declared twice on purpose. The Edge
 * Functions (Deno) and the Vite app share no module graph, and importing the
 * Deno module from `src/` would drag Deno-targeted code into the browser
 * bundle. The cost of that duplication is drift: the browser parser rejects
 * any payload that does not match its copy, so a renamed or retyped field on
 * either side would make the marketing page's prices vanish silently, with no
 * error and no failing runtime test.
 *
 * This file closes that gap at `tsc` time. Both imports are `import type`, so
 * nothing here reaches a bundle or a runtime. It checks assignability in both
 * directions so neither side can add a required field the other lacks. It is

 * Placed under src/ because the app project can resolve both declarations
 * (the test project cannot compile the browser module: it lacks Vite types).
 * It is never imported, so it is not part of the bundle. It is
 * not a tautology; do not delete it as one. If it fails, update the two
 * declarations together.
 */
import type { PublicPlan as BrowserPlan, PublicPricing as BrowserPricing } from './api'
import type {
  PublicPlan as FunctionPlan,
  PublicPricing as FunctionPricing,
} from '../../../supabase/functions/_shared/public-pricing.ts'

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

export const publicPlanShapesMatch: MutuallyAssignable<BrowserPlan, FunctionPlan> = true
export const publicPricingShapesMatch: MutuallyAssignable<BrowserPricing, FunctionPricing> = true
