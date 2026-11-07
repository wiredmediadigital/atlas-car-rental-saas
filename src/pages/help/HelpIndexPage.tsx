import { HelpGroupCard } from '@/features/help/components/HelpGroupCard'
import { HelpLayout } from '@/features/help/components/HelpLayout'
import { getHelpPage } from '@/features/help/content'
import { HELP_NAVIGATION } from '@/features/help/navigation'
import { useDocumentMeta } from '@/features/help/useDocumentMeta'
import { getAppName } from '@/lib/config/env'

/**
 * The Help Centre front door, at `/help`: one card per navigation group.
 *
 * Public, like every help route. It renders from `HELP_NAVIGATION` and each
 * page's own front matter, so nothing here names a group or a page. A group
 * whose pages are not written yet has no resolvable page and so no card —
 * the index never shows a placeholder.
 */
export function HelpIndexPage() {
  useDocumentMeta('Help centre', `Guides and how-tos for using ${getAppName()}, grouped by topic.`)

  const cards = HELP_NAVIGATION.map((entry) => ({
    group: entry.group,
    pages: entry.slugs.flatMap((slug) => {
      const page = getHelpPage(slug)
      return page ? [{ slug, title: page.frontMatter.title }] : []
    }),
  })).filter((card) => card.pages.length > 0)

  return (
    <HelpLayout>
      <div className="max-w-prose">
        <p className="eyebrow">Help centre</p>
        <h1 className="text-ink mt-3 text-2xl">Help centre</h1>
        <p className="text-ink-muted mt-3 text-sm leading-6">Pick a topic to get started.</p>
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <HelpGroupCard key={card.group} group={card.group} pages={card.pages} />
        ))}
      </div>
    </HelpLayout>
  )
}
