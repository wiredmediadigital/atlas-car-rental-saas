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
 * It lists only slugs that have a Markdown file. The remaining pages arrive in
 * Task 11 and are added here as they land — listing them now would point the
 * sidebar at files that do not exist, which is a dead link in the one place a
 * lost reader goes to stop being lost. `navigation.test.ts` holds that line:
 * every slug here must resolve, and must sit under the group its own front
 * matter declares.
 *
 * A group with no pages yet is left out entirely rather than listed empty:
 * `help-index.test.tsx` renders a card per entry and reads the titles behind
 * its slugs, so an entry naming nothing has no card for those assertions to
 * find.
 *
 * Groups appear in `HELP_GROUPS` order, which is the order the app groups its
 * own sidebar by.
 */
export const HELP_NAVIGATION: readonly HelpNavigationGroup[] = [
  { group: 'Operations', slugs: ['rentals'] },
  { group: 'Fleet', slugs: ['vehicles'] },
  { group: 'Agency', slugs: ['team'] },
]
