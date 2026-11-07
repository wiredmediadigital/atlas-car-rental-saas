import { describe, expect, it } from 'vitest'

import { paths } from '@/app/routes/paths'

import { getHelpPage } from './content'
import { helpSlugForRoute } from './route-topics'

/*
 * Run against the real content, with expectations derived from it: whichever
 * pages exist today, a route gets a slug exactly when its page resolves.
 */
const moduleRoutes = [
  paths.overview,
  paths.rentals,
  paths.rentalNew,
  paths.calendar,
  paths.customers,
  paths.customerNew,
  paths.vehicles,
  paths.vehicleNew,
  paths.gpsTracking,
  paths.expenses,
  paths.expenseNew,
  paths.financing,
  paths.financingNew,
  paths.reports,
  paths.notifications,
  paths.team,
  paths.billing,
  paths.billingReturn,
  paths.settings,
]

describe('helpSlugForRoute', () => {
  it('only ever returns a slug whose page exists', () => {
    for (const route of moduleRoutes) {
      const slug = helpSlugForRoute(route)
      if (slug !== null) expect(getHelpPage(slug)).toBeDefined()
    }
  })

  it('resolves rentals, which has a page, including its detail routes', () => {
    expect(getHelpPage('rentals')).toBeDefined()
    expect(helpSlugForRoute(paths.rentals)).toBe('rentals')
    expect(helpSlugForRoute('/rentals/abc')).toBe('rentals')
    expect(helpSlugForRoute('/rentals/')).toBe('rentals')
  })

  it('returns null for routes outside the product modules', () => {
    for (const route of [
      '/nowhere',
      paths.signIn,
      paths.help,
      '/help/rentals',
      paths.createAgency,
    ]) {
      expect(helpSlugForRoute(route)).toBeNull()
    }
  })
})
