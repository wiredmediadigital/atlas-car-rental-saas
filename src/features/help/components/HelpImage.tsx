import { helpImageSize } from '../images'

export interface HelpImageProps {
  src?: string
  alt?: string
}

/**
 * A screenshot in help prose.
 *
 * Pages are written before every screenshot has arrived, so an image the
 * manifest does not know is an ordinary state, not an error: it renders a
 * visible gap that says what is missing and the prose around it carries on.
 * Failing the page for a missing picture would block the words that already
 * work.
 *
 * Missing alt text is the opposite case. It cannot be fixed by waiting for a
 * file, and an image nobody can read is a defect, so it throws. The content
 * tests catch it long before a reader can.
 */
export function HelpImage({ src, alt }: HelpImageProps) {
  if (alt === undefined || alt.trim() === '') {
    throw new Error(`Help image ${src ?? '(no source)'} has no alt text. Alt text is mandatory.`)
  }

  const size = src === undefined ? undefined : helpImageSize(src)

  if (src === undefined || size === undefined) {
    return (
      <span
        role="img"
        aria-label={alt}
        className="border-line bg-surface-inset text-ink-subtle mt-4 flex aspect-video w-full items-center justify-center rounded-lg border border-dashed px-4 text-center text-xs"
      >
        Screenshot not available yet
      </span>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      width={size.width}
      height={size.height}
      loading="lazy"
      decoding="async"
      className="border-line mt-4 block h-auto max-w-full rounded-lg border"
    />
  )
}
