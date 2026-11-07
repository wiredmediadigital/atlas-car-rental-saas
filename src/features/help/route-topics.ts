import { paths } from '@/app/routes/paths'

import { helpPageExists } from './slugs'

/** The first path segment, which is the module: `/rentals/abc` -> `rentals`. */
function moduleSegment(path: string): string {
  return path.split('/')[1] ?? ''
}

/**
 * Each product module's route, mapped to the slug its help page will have.
 *
 * Keyed by first segment, derived from `paths` so no route string is written
 * here. Detail, creation and edit routes (`/rentals/new`, `/financing/:id/edit`)
 * share their module's segment and so inherit its page, which is the right page
 * for all of them: a module's help covers creating and reading its records.
 *
 * This lists the eventual slugs, including pages that do not exist yet. That is
 * safe only because `helpSlugForRoute` checks existence before returning one.
 *
 * Existence comes from `slugs.ts`, not `content.ts`: this module is reached
 * from every module page through `PageHeader`, and the page bodies have no
 * business in the application entry chunk.
 */
const MODULE_HELP_SLUGS: ReadonlyMap<string, string> = new Map([
  [moduleSegment(paths.overview), 'overview'],
  [moduleSegment(paths.rentals), 'rentals'],
  [moduleSegment(paths.calendar), 'calendar'],
  [moduleSegment(paths.customers), 'customers'],
  [moduleSegment(paths.vehicles), 'vehicles'],
  [moduleSegment(paths.gpsTracking), 'gps-tracking'],
  [moduleSegment(paths.expenses), 'expenses'],
  [moduleSegment(paths.financing), 'financing'],
  [moduleSegment(paths.reports), 'reports'],
  [moduleSegment(paths.notifications), 'notifications'],
  [moduleSegment(paths.team), 'team'],
  [moduleSegment(paths.billing), 'billing'],
  [moduleSegment(paths.settings), 'settings'],
])

/**
 * The help page for the module a route belongs to, or `null`.
 *
 * `null` for a route that maps to no module, and equally for one that maps to a
 * page nobody has written yet. A link to a help page that 404s is worse than no
 * link, so as pages land the links appear without anything here changing.
 */
export function helpSlugForRoute(pathname: string): string | null {
  const slug = MODULE_HELP_SLUGS.get(moduleSegment(pathname))
  if (slug === undefined) return null
  return helpPageExists(slug) ? slug : null
}
