import { render } from '@testing-library/react'

import { getAppName, resetEnvironmentCache } from '@/lib/config/env'

import { useDocumentMeta } from './useDocumentMeta'

function Probe({ title, description }: { title: string; description: string }) {
  useDocumentMeta(title, description)
  return null
}

function metaDescription(): string | null {
  return document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null
}

function metaCount(): number {
  return document.querySelectorAll('meta[name="description"]').length
}

beforeEach(() => {
  resetEnvironmentCache()
  document.title = 'Original title'
  document.head.querySelectorAll('meta[name="description"]').forEach((node) => node.remove())
  const meta = document.createElement('meta')
  meta.setAttribute('name', 'description')
  meta.setAttribute('content', 'Original description')
  document.head.appendChild(meta)
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetEnvironmentCache()
})

describe('useDocumentMeta', () => {
  test('sets document.title to the page title and the product name', () => {
    render(<Probe title="Rentals" description="How rentals work." />)

    expect(document.title).toBe(`Rentals | ${getAppName()}`)
  })

  test('uses the renamed product name from VITE_APP_NAME', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    vi.stubEnv('VITE_APP_NAME', 'Renamed Rentals')
    resetEnvironmentCache()

    render(<Probe title="Rentals" description="x" />)

    expect(document.title).toBe('Rentals | Renamed Rentals')
  })

  test('sets the meta description to the page summary without adding a second tag', () => {
    render(<Probe title="Rentals" description="How rentals work." />)

    expect(metaDescription()).toBe('How rentals work.')
    expect(metaCount()).toBe(1)
  })

  test('restores the previous title and description when the component unmounts', () => {
    const { unmount } = render(<Probe title="Rentals" description="How rentals work." />)

    unmount()

    expect(document.title).toBe('Original title')
    expect(metaDescription()).toBe('Original description')
    expect(metaCount()).toBe(1)
  })

  test('follows new values and still restores the original on unmount', () => {
    const { rerender, unmount } = render(<Probe title="Rentals" description="First." />)

    rerender(<Probe title="Vehicles" description="Second." />)
    expect(document.title).toBe(`Vehicles | ${getAppName()}`)
    expect(metaDescription()).toBe('Second.')

    unmount()
    expect(document.title).toBe('Original title')
    expect(metaDescription()).toBe('Original description')
  })

  test('creates the description tag when none exists and removes it on unmount', () => {
    document.head.querySelectorAll('meta[name="description"]').forEach((node) => node.remove())

    const { unmount } = render(<Probe title="Rentals" description="Made up." />)
    expect(metaDescription()).toBe('Made up.')

    unmount()
    expect(metaCount()).toBe(0)
  })
})
