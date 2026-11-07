import { helpImageSize } from '../images'

export interface HelpImageProps {
  src?: string
  alt?: string
}

/**
 * A screenshot in help prose.
 *
 * An image is never allowed to take the page down. Pages are written before
 * every screenshot has arrived, so an image the manifest does not know is an
 * ordinary state: it renders a visible gap and the prose around it carries on.
 * Blank alt text is handled the same way. It renders as `alt=""`, which is
 * valid decorative markup, rather than throwing, because the app's single
 * top-level error boundary would turn one bad attribute into a "page stopped
 * responding" card for the whole article, and reloading cannot fix an authoring
 * error.
 *
 * The authoring gate for alt text is `image-references.test.ts`, which fails
 * the build when a page references an image without it. A development-only
 * console error is the second line, for the page being written right now.
 */
export function HelpImage({ src, alt }: HelpImageProps) {
  const altText = alt?.trim() ?? ''

  if (import.meta.env.DEV && altText === '') {
    console.error(`Help image ${src ?? '(no source)'} has no alt text. Add it in the Markdown.`)
  }

  const size = src === undefined ? undefined : helpImageSize(src)

  if (src === undefined || size === undefined) {
    return (
      <span
        {...(altText === '' ? {} : { role: 'img', 'aria-label': altText })}
        className="border-line bg-surface-inset text-ink-subtle mt-4 flex aspect-video w-full items-center justify-center rounded-lg border border-dashed px-4 text-center text-xs"
      >
        Screenshot not available yet
      </span>
    )
  }

  return (
    <img
      src={src}
      alt={altText}
      width={size.width}
      height={size.height}
      loading="lazy"
      decoding="async"
      className="border-line mt-4 block h-auto max-w-full rounded-lg border"
    />
  )
}
