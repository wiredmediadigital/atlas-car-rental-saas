import { parseFrontMatter } from './frontmatter'
import type { HelpPage } from './types'

const rawPages = import.meta.glob('../../content/help/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const pages: readonly HelpPage[] = Object.entries(rawPages)
  .map(([path, raw]) => {
    const fileName = path.slice(path.lastIndexOf('/') + 1)
    const slug = fileName.replace(/\.md$/, '')
    const { frontMatter, body } = parseFrontMatter(raw, fileName)
    return { slug, frontMatter, body }
  })
  .sort((a, b) => a.slug.localeCompare(b.slug))

export function loadHelpPages(): readonly HelpPage[] {
  return pages
}

export function getHelpPage(slug: string): HelpPage | undefined {
  return pages.find((page) => page.slug === slug)
}
