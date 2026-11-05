import { getAppName } from '@/lib/config/env'
import { cn } from '@/lib/utils/cn'

import markUrl from '@/assets/brand/pevvy-mark.png'

/** The mark's intrinsic pixel size, so the browser reserves the right box before it loads. */
const MARK_WIDTH = 128
const MARK_HEIGHT = 101

export interface WordmarkProps {
  /** `inverse` is for the deep brand panel; `default` for light surfaces. */
  tone?: 'default' | 'inverse'
  /** `lg` is for surfaces where the identity should read as slightly more prominent, e.g. a public header. Defaults to the size used everywhere else in the product. */
  size?: 'default' | 'lg'
  className?: string
}

/**
 * The product mark: the car-and-road monogram beside the name.
 *
 * The name is live text rather than part of the image, for two reasons. It
 * follows `getAppName()`, so a deployment that renames the app renames its own
 * header instead of showing one name in the picture and another everywhere
 * else. And it takes the tone it is given — the supplied artwork sets the name
 * in navy, which all but disappears against the deep brand panel behind the
 * sign-in form.
 *
 * The monogram itself carries its own colour and needs no plate behind it: it
 * is green and white, which reads on both the light surfaces and that panel.
 */
export function Wordmark({ tone = 'default', size = 'default', className }: WordmarkProps) {
  const isInverse = tone === 'inverse'
  const isLarge = size === 'lg'

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <img
        src={markUrl}
        alt=""
        aria-hidden="true"
        width={MARK_WIDTH}
        height={MARK_HEIGHT}
        className={cn('w-auto', isLarge ? 'h-8' : 'h-7')}
      />
      <span
        className={cn(
          'font-semibold tracking-tight',
          isLarge ? 'text-base' : 'text-[0.9375rem]',
          isInverse ? 'text-ink-inverse' : 'text-ink',
        )}
      >
        {getAppName()}
      </span>
    </span>
  )
}
