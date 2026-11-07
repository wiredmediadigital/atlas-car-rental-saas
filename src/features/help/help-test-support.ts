import { configure } from '@testing-library/react'

/**
 * How long a `findBy` in a help test waits before giving up.
 *
 * Testing Library's own default is one second, and it is independent of
 * Vitest's `testTimeout`. Raising it costs nothing when an element does appear
 * — `findBy` resolves the moment it does — and buys headroom on the one thing
 * these tests cannot control: a lazy route resolving while ninety-odd other
 * files are competing for the same machine.
 */
const HELP_ASYNC_TIMEOUT_MS = 10_000

/**
 * Pre-loads the lazy help route chunks.
 *
 * `AppRouter` imports the help pages lazily, so the first test to visit one
 * pays for a cold module transform — measured at 24s in a loaded full-suite
 * run, against a 1s `findBy` default. Calling this from a `beforeAll` moves
 * that cost under the hook timeout, where it cannot fail a test. Every test
 * file that renders `AppRouter` at a help route should do so.
 *
 * Importing the modules is necessary and, on a loaded machine, not sufficient:
 * `React.lazy` still has to see the resolved promise and re-render, and a full
 * run has been observed failing that race against a one-second wait while the
 * Suspense fallback was still on screen. So the wait is widened here too, in
 * the one place every help test already calls.
 */
export async function warmHelpRoutes(): Promise<void> {
  configure({ asyncUtilTimeout: HELP_ASYNC_TIMEOUT_MS })
  await import('@/pages/help/HelpIndexPage')
  await import('@/pages/help/HelpArticlePage')
}
