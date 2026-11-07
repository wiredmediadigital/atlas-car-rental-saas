import { useParams } from 'react-router-dom'

import { HelpArticle } from '@/features/help/components/HelpArticle'
import { HelpLayout } from '@/features/help/components/HelpLayout'
import { HelpSidebar } from '@/features/help/components/HelpSidebar'
import { OnThisPage } from '@/features/help/components/OnThisPage'
import { getHelpPage } from '@/features/help/content'
import { helpSections } from '@/features/help/sections'
import { resolveTokens } from '@/features/help/tokens'
import { useDocumentMeta } from '@/features/help/useDocumentMeta'

import { HelpNotFound } from './HelpNotFound'

const NOT_FOUND_TITLE = 'Page not found'
const NOT_FOUND_DESCRIPTION = 'This help page does not exist. Browse the help centre for a topic.'

/**
 * One help article, at `/help/<slug>`.
 *
 * Public: this page asks nothing of the session and renders identically signed
 * in or out. Tokens are resolved before the sections are read, so a heading
 * written with `{{productName}}` anchors and labels under the name the reader
 * actually sees.
 *
 * An unknown slug renders `HelpNotFound` inside this same layout rather than
 * redirecting — see the comment there for why that matters.
 */
export function HelpArticlePage() {
  const { slug } = useParams<{ slug: string }>()
  const page = slug === undefined ? undefined : getHelpPage(slug)
  const body = page ? resolveTokens(page.body) : ''
  const sections = helpSections(body)

  useDocumentMeta(
    page ? resolveTokens(page.frontMatter.title) : NOT_FOUND_TITLE,
    page ? resolveTokens(page.frontMatter.summary) : NOT_FOUND_DESCRIPTION,
  )

  return (
    <HelpLayout
      sidebar={<HelpSidebar activeSlug={slug} />}
      aside={page ? <OnThisPage sections={sections} /> : null}
    >
      {page ? <HelpArticle page={page} body={body} sections={sections} /> : <HelpNotFound />}
    </HelpLayout>
  )
}
