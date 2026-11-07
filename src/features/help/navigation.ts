import type { HelpGroup } from './types'

export interface HelpNavigationGroup {
  readonly group: HelpGroup
  readonly slugs: readonly string[]
}

/**
 * The Help Centre's page tree, hand-authored.
 *
 * Not generated from `navigationGroups`: Notifications is reached from the bell
 * rather than the sidebar and has no entry there, while Getting started and
 * Reference describe no module at all. The tree a reader needs is not the tree
 * the product navigates by.
 *
 * It lists only slugs that have a Markdown file — listing one that does not
 * would point the sidebar at a dead link in the one place a lost reader goes to
 * stop being lost. `navigation.test.ts` holds that line: every slug here must
 * resolve, and must sit under the group its own front matter declares.
 *
 * A group with no pages is left out entirely rather than listed empty:
 * `help-index.test.tsx` renders a card per entry and reads the titles behind
 * its slugs, so an entry naming nothing has no card for those assertions to
 * find.
 *
 * Groups appear in `HELP_GROUPS` order, which is the order the app groups its
 * own sidebar by. Within a group the order is the reading order of the design's
 * page inventory, which for the module groups is the sidebar's own order.
 */
export const HELP_NAVIGATION: readonly HelpNavigationGroup[] = [
  { group: 'Overview', slugs: ['overview'] },
  { group: 'Operations', slugs: ['rentals', 'calendar', 'customers'] },
  { group: 'Fleet', slugs: ['vehicles', 'gps-tracking'] },
  { group: 'Finance', slugs: ['expenses', 'financing', 'reports'] },
  { group: 'Agency', slugs: ['team', 'billing', 'settings', 'notifications'] },
]
