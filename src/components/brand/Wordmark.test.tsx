import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Wordmark } from './Wordmark'

describe('the product mark', () => {
  it('spells the name as text, not as part of the picture', () => {
    /*
     * The supplied artwork is a lockup with "Pevvy" drawn into it. Baking that
     * in would freeze the name: getAppName() is configurable, and a deployment
     * that renames the app would show one name in the image and another in
     * every page title.
     */
    render(<Wordmark />)
    expect(screen.getByText('Pevvy')).toBeInTheDocument()
  })

  it('shows the monogram without announcing it twice', () => {
    // The name is already readable beside it, so the image is decorative.
    const { container } = render(<Wordmark />)
    const image = container.querySelector('img')
    expect(image).not.toBeNull()
    expect(image).toHaveAttribute('alt', '')
    expect(image).toHaveAttribute('aria-hidden', 'true')
  })

  it('reserves the space it will occupy before the image loads', () => {
    // Without both dimensions the header reflows when the mark arrives.
    const { container } = render(<Wordmark />)
    const image = container.querySelector('img')
    expect(image).toHaveAttribute('width')
    expect(image).toHaveAttribute('height')
  })

  it('lets the name take the tone it is given', () => {
    // The mark is green and white on every surface; only the name changes.
    const { container: light } = render(<Wordmark />)
    const { container: dark } = render(<Wordmark tone="inverse" />)
    expect(light.querySelector('img')?.getAttribute('src')).toBe(
      dark.querySelector('img')?.getAttribute('src'),
    )
    expect(dark.textContent).toContain('Pevvy')
  })
})
