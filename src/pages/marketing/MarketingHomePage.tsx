import { usePublicPricing } from '@/features/marketing/queries'

import { Differentiation } from './components/Differentiation'
import { Faq } from './components/Faq'
import { FeatureGrid } from './components/FeatureGrid'
import { FinalCta } from './components/FinalCta'
import { Hero } from './components/Hero'
import { MarketingFooter } from './components/MarketingFooter'
import { MarketingHeader } from './components/MarketingHeader'
import { PricingSection } from './components/PricingSection'
import { StorySections } from './components/StorySections'

/**
 * The public, customer-facing homepage — shown at `/` to a signed-out
 * visitor only (see the `publicHome` branch in `RequireAuth`). An
 * authenticated user never sees this: `/` opens the Overview dashboard for
 * them exactly as it always has.
 *
 * This is its own lazy route chunk (see AppRouter.tsx), so nothing here pulls
 * in the authenticated shell, its feature modules, MapLibre or React PDF —
 * a signed-out visit to `/` downloads only this page.
 */
export function MarketingHomePage() {
  /*
   * The one pricing request. The section, its nav link and its FAQ entry all
   * take this result as a prop and decide with `hasRenderablePricing`, so they
   * appear together or not at all (an unconfigured install shows none of them).
   */
  const { data: pricing } = usePublicPricing()

  return (
    <div className="bg-canvas min-h-dvh">
      <MarketingHeader pricing={pricing} />
      <main id="main">
        <Hero />
        <StorySections />
        <FeatureGrid />
        <Differentiation />
        <PricingSection pricing={pricing} />
        <FinalCta />
        <Faq pricing={pricing} />
      </main>
      <MarketingFooter />
    </div>
  )
}
