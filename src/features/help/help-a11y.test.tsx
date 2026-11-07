import { act, cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { helpArticlePath } from '@/app/routes/paths'
import { HelpArticlePage } from '@/pages/help/HelpArticlePage'
import { HelpIndexPage } from '@/pages/help/HelpIndexPage'

import { HelpMobileNav } from './components/HelpMobileNav'
import { loadHelpPages } from './content'
import { warmHelpRoutes } from './help-test-support'
import { HELP_NAVIGATION } from './navigation'
import { helpSections } from './sections'
import { resolveTokens } from './tokens'

/*
 * Accessibility guards over the real content. Everything iterates
 * `loadHelpPages()` / `HELP_NAVIGATION` so the assertions hold as pages are
 * added; nothing here knows how many there are.
 */

beforeAll(warmHelpRoutes)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderArticle(slug: string) {
  return render(
    <MemoryRouter initialEntries={[helpArticlePath(slug)]}>
      <Routes>
        <Route path="/help/:slug" element={<HelpArticlePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const slugs = loadHelpPages().map((page) => page.slug)

describe('the help sidebar', () => {
  it.each(slugs)('%s: is a nav with an accessible name', (slug) => {
    renderArticle(slug)

    expect(screen.getAllByRole('navigation', { name: 'Help pages' }).length).toBeGreaterThan(0)
  })

  it.each(slugs)('marks %s as the current page, and only it', (slug) => {
    renderArticle(slug)
    const [sidebar] = screen.getAllByRole('navigation', { name: 'Help pages' })
    const inTree = HELP_NAVIGATION.some((entry) => entry.slugs.includes(slug))

    const current = within(sidebar as HTMLElement)
      .queryAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')

    // A page the sidebar does not list has nothing to mark; every other page
    // marks exactly itself.
    expect(current).toHaveLength(inTree ? 1 : 0)
    if (inTree) expect(current[0]?.getAttribute('href')).toBe(helpArticlePath(slug))
  })
})

describe('every help article', () => {
  it.each(slugs)('%s: on-this-page links resolve to unique heading ids', (slug) => {
    const { container } = renderArticle(slug)
    const rail = screen.queryByRole('navigation', { name: 'On this page' })
    const body = resolveTokens(loadHelpPages().find((page) => page.slug === slug)?.body ?? '')
    const hasSections = helpSections(body).length > 0

    const ids = Array.from(container.querySelectorAll('[id]')).map((el) => el.id)
    expect(new Set(ids).size, `duplicate ids on ${slug}`).toBe(ids.length)

    // The rail exists exactly when the page has task sections; its absence is
    // asserted rather than used as a way out of the link checks.
    expect(rail === null, `rail presence on ${slug}`).toBe(!hasSections)
    if (rail === null) return
    const links = within(rail).getAllByRole('link')
    const targets = links.map((link) => (link.getAttribute('href') ?? '').replace(/^#/, ''))
    expect(new Set(targets).size, `two jump links share a target on ${slug}`).toBe(targets.length)
    for (const target of targets) {
      const element = container.querySelector(`[id="${target}"]`)
      expect(element, `#${target} on ${slug}`).not.toBeNull()
      expect(element?.tagName).toBe('H2')
    }
  })

  it.each(slugs)('%s: every image has non-empty alt text', (slug) => {
    renderArticle(slug)
    // The article, not the page chrome: the wordmark in the header is a
    // decorative image inside a link that carries its own name.
    const container = screen.getByRole('main')

    for (const image of Array.from(container.querySelectorAll('img'))) {
      expect(image.getAttribute('alt')?.trim() ?? '', image.src).not.toBe('')
    }
    // A placeholder for a missing screenshot must still be labelled.
    for (const placeholder of Array.from(container.querySelectorAll('[role="img"]'))) {
      expect(placeholder.getAttribute('aria-label')?.trim() ?? '').not.toBe('')
    }
  })

  it.each(slugs)('%s: headings descend without skipping a level', (slug) => {
    const { container } = renderArticle(slug)

    assertHeadingsDescend(container, slug)
  })
})

describe('the help index', () => {
  it('has headings that descend without skipping a level', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/help']}>
        <HelpIndexPage />
      </MemoryRouter>,
    )

    assertHeadingsDescend(container, '/help')
  })
})

function assertHeadingsDescend(container: HTMLElement, where: string) {
  const levels = Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) =>
    Number(h.tagName.slice(1)),
  )
  expect(levels[0], `${where} starts with an h1`).toBe(1)
  expect(
    levels.filter((level) => level === 1),
    `${where} has one h1`,
  ).toHaveLength(1)
  /*
   * An h1 followed straight by an h3, with no h2 anywhere above it, is allowed.
   * Pages open with a "concept" block of `###` headings before their first task
   * section; `sections.ts` defines `###` as a detail, not a task, so those must
   * not be promoted to `##` just to satisfy this check (that would also put
   * concepts in "On this page" on some pages and not others). It is a WCAG
   * advisory technique (G141), not a Level A failure. Every other skipped
   * level, and any skip once an h2 has appeared, still fails.
   */
  let hasSeenH2 = false
  levels.forEach((level, index) => {
    if (level === 2) hasSeenH2 = true
    if (index === 0) return
    const previous = levels[index - 1] ?? 1
    if (previous === 1 && level === 3 && !hasSeenH2) return
    expect(level, `${where}: h${previous} followed by h${level}`).toBeLessThanOrEqual(previous + 1)
  })
}

describe('the skip link', () => {
  it.each(slugs)('%s: is the first thing to tab to and targets the main landmark', (slug) => {
    const { container } = renderArticle(slug)

    const first = container.querySelector('a, button, input, [tabindex]')
    expect(first?.textContent).toBe('Skip to content')
    expect(first?.getAttribute('href')).toBe('#main')
    expect(screen.getByRole('main').id).toBe('main')
  })

  it('leaves the landmark clear of the sticky header once it has jumped', () => {
    // Without a scroll margin the header, `top-0` over an `h-16` row, covers
    // the breadcrumb and part of the h1 the jump was meant to reach.
    renderArticle(slugs[0] ?? '')

    expect(screen.getByRole('main').className).toContain('scroll-mt-')
  })
})

describe('the mobile navigation dialog', () => {
  /** A controllable `(min-width: 1024px)` media query. */
  function stubViewport() {
    const listeners = new Set<(event: MediaQueryListEvent) => void>()
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) =>
        listeners.delete(fn),
    }))
    return (matches: boolean) =>
      act(() => {
        listeners.forEach((fn) => fn({ matches } as MediaQueryListEvent))
      })
  }

  function openDialog() {
    render(
      <MemoryRouter>
        <HelpMobileNav>
          <p>tree</p>
        </HelpMobileNav>
      </MemoryRouter>,
    )
    act(() => screen.getByRole('button', { name: 'Open help navigation' }).click())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  }

  it('closes, releasing the scroll lock, when the viewport widens past lg', () => {
    const setViewportIsWide = stubViewport()
    openDialog()

    setViewportIsWide(true)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.pointerEvents).not.toBe('none')
  })

  it('stays open when the viewport narrows', () => {
    const setViewportIsWide = stubViewport()
    openDialog()

    setViewportIsWide(false)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
