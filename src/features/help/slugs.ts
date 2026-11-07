/**
 * Which help pages exist, by slug — without loading a word of any of them.
 *
 * `content.ts` reads every Markdown file eagerly and parses its front matter,
 * which is right for the two help pages that render prose and wrong for
 * everywhere else. `PageHeader` sits in `components/ui`, so every module page
 * reaches it, and all it ever asks is whether a page exists before showing a
 * link to it. Importing `content.ts` for that answer put the whole corpus —
 * nineteen files, ~215 kB — into the application entry chunk, where a
 * signed-out visitor at the sign-in screen downloaded and parsed all of it
 * before first paint.
 *
 * A lazy glob is used only for its keys: Vite resolves the file list at build
 * time, so the names are static while the bodies stay behind import thunks that
 * nothing here ever calls. The same idiom reads `public/help` in
 * `image-references.test.ts`.
 */
const slugs: ReadonlySet<string> = new Set(
  Object.keys(import.meta.glob('../../content/help/*.md', { query: '?raw' })).map((path) =>
    path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  ),
)

/** True when `src/content/help/<slug>.md` exists. */
export function helpPageExists(slug: string): boolean {
  return slugs.has(slug)
}
