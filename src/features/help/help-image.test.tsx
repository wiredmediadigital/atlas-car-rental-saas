import { render, screen } from '@testing-library/react'

import { HelpImage } from './components/HelpImage'
import { HelpMarkdown } from './components/HelpMarkdown'
import { HELP_IMAGE_MANIFEST } from './images'

/** Any entry will do; the test reads its expected size from the data, not from memory. */
function firstManifestEntry() {
  const [fileName, size] = Object.entries(HELP_IMAGE_MANIFEST)[0] ?? []
  if (!fileName || !size) throw new Error('The image manifest is empty; run npm run help:images.')
  return { src: `/help/${fileName}`, size }
}

describe('HelpImage', () => {
  test('renders width and height from the manifest so the layout does not shift', () => {
    const { src, size } = firstManifestEntry()

    render(<HelpImage src={src} alt="The rentals list" />)

    const image = screen.getByRole('img', { name: 'The rentals list' })
    expect(image).toHaveAttribute('src', src)
    expect(image).toHaveAttribute('width', String(size.width))
    expect(image).toHaveAttribute('height', String(size.height))
  })

  test('renders loading="lazy" and decoding="async"', () => {
    const { src } = firstManifestEntry()

    render(<HelpImage src={src} alt="The rentals list" />)

    const image = screen.getByRole('img', { name: 'The rentals list' })
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('decoding', 'async')
  })

  test('renders a visible placeholder when the source is absent from the manifest', () => {
    render(<HelpImage src="/help/not-captured-yet.jpg" alt="The not yet captured screen" />)

    expect(screen.getByRole('img', { name: 'The not yet captured screen' })).toBeInTheDocument()
    expect(screen.getByText(/screenshot not available/i)).toBeVisible()
    expect(document.querySelector('img')).toBeNull()
  })

  test('treats a source outside /help/ as absent rather than fetching it', () => {
    render(<HelpImage src="https://example.com/tracker.jpg" alt="Somewhere else" />)

    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText(/screenshot not available/i)).toBeVisible()
  })

  test.each([undefined, '', '   '])('throws when alt text is %j', (alt) => {
    const { src } = firstManifestEntry()
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => render(<HelpImage src={src} alt={alt} />)).toThrow(/alt text/i)

    quiet.mockRestore()
  })

  test('throws for a missing image without alt text too, so the defect cannot hide behind the gap', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => render(<HelpImage src="/help/not-captured-yet.jpg" />)).toThrow(/alt text/i)

    quiet.mockRestore()
  })
})

describe('images inside help prose', () => {
  test('a missing image leaves a gap and the surrounding prose intact', () => {
    const body =
      'Before the picture.\n\n![The missing screen](/help/not-captured-yet.jpg)\n\nAfter the picture.'

    render(<HelpMarkdown body={body} sections={[]} />)

    expect(screen.getByText('Before the picture.')).toBeVisible()
    expect(screen.getByText('After the picture.')).toBeVisible()
    expect(screen.getByText(/screenshot not available/i)).toBeVisible()
  })

  test('a present image renders through the markdown pipeline with its dimensions', () => {
    const { src, size } = firstManifestEntry()

    render(<HelpMarkdown body={`![A real capture](${src})`} sections={[]} />)

    const image = screen.getByRole('img', { name: 'A real capture' })
    expect(image).toHaveAttribute('width', String(size.width))
    expect(image).toHaveAttribute('height', String(size.height))
  })
})
