import { render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AppRouter } from '@/app/routes/AppRouter'
import { getAppName } from '@/lib/config/env'

import { loadHelpPages } from './content'
import { warmHelpRoutes } from './help-test-support'
import { resolveTokens } from './tokens'

/*
 * Rendered through `AppRouter` for the same reason as help-routing.test.tsx:
 * the metadata must be set by the real route, and must be gone once the reader
 * leaves it. Expectations come from the content files, never a page count.
 */

vi.mock('@/lib/supabase/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSupabaseClient: vi.fn(() => {
    throw new Error('The Help Centre must not reach Supabase.')
  }),
}))

beforeAll(warmHelpRoutes)

function visit(path: string) {
  window.history.pushState({}, '', path)
  return render(<AppRouter />)
}

function metaDescription(): string | null {
  return document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null
}

afterEach(() => {
  window.history.pushState({}, '', '/')
})

describe('help route metadata', () => {
  it('titles every article after its own front matter and the product name', async () => {
    for (const page of loadHelpPages()) {
      const { unmount } = visit(`/help/${page.slug}`)
      await screen.findByRole('heading', { level: 1 })

      expect(document.title).toBe(`${resolveTokens(page.frontMatter.title)} | ${getAppName()}`)
      expect(metaDescription()).toBe(resolveTokens(page.frontMatter.summary))
      unmount()
    }
  })

  it('never leaves an unresolved token in the tab or the description', async () => {
    for (const page of loadHelpPages()) {
      const { unmount } = visit(`/help/${page.slug}`)
      await screen.findByRole('heading', { level: 1 })

      expect(document.title).not.toContain('{{')
      expect(metaDescription()).not.toContain('{{')
      unmount()
    }
  })

  it('gives the index its own title and a description', async () => {
    visit('/help')
    await screen.findByRole('heading', { level: 1, name: 'Help centre' })

    expect(document.title).toBe(`Help centre | ${getAppName()}`)
    expect(metaDescription()).toContain(getAppName())
  })

  it('titles an unknown slug as not found rather than as an article', async () => {
    visit('/help/no-such-page-anywhere')
    await screen.findByRole('heading', { level: 1 })

    expect(document.title).toBe(`Page not found | ${getAppName()}`)
  })

  it('restores the title the app had once the reader leaves the help page', async () => {
    document.title = 'App title'
    const { unmount } = visit('/help')
    await screen.findByRole('heading', { level: 1, name: 'Help centre' })

    unmount()

    expect(document.title).toBe('App title')
  })
})
