/**
 * Pre-loads the lazy help route chunks.
 *
 * `AppRouter` imports the help pages lazily, so the first test to visit one
 * pays for a cold module transform — measured at 24s in a loaded full-suite
 * run, against a 1s `findBy` default. Calling this from a `beforeAll` moves
 * that cost under the hook timeout, where it cannot fail a test. Every test
 * file that renders `AppRouter` at a help route should do so.
 */
export async function warmHelpRoutes(): Promise<void> {
  await import('@/pages/help/HelpIndexPage')
  await import('@/pages/help/HelpArticlePage')
}
