/**
 * The one visual design every outgoing message shares.
 *
 * WHY A MODULE AND NOT SEVEN HTML FILES.
 *
 * This product sends mail from two places that cannot see each other. Four
 * messages are composed by our own Edge Functions on Deno. The rest are composed
 * by GoTrue, Supabase's auth service, which renders Go `html/template` files
 * from disk and has never heard of our TypeScript. Left alone, that boundary
 * guarantees drift: somebody adjusts the button colour in the invitation email
 * and the password reset keeps the old one for a year, because nothing connects
 * them.
 *
 * So the design lives here, once, and the GoTrue templates are GENERATED from it
 * by `scripts/build-email-templates.ts`. The generated files are committed —
 * GoTrue needs real files on disk — and a test re-runs the generator and fails
 * if what is committed is not what this module produces. The boundary still
 * exists; it just cannot drift silently any more.
 *
 * WHY THE TOKENS ARE COPIED RATHER THAN IMPORTED.
 *
 * The same reason `PRODUCT_NAME` is copied into team-email.ts: this runs on Deno
 * inside an Edge Function, and `src/styles/index.css` is a Tailwind theme block
 * consumed by Vite. There is no import that crosses that. The copy is held in
 * step by `supabase/tests/email-layout.test.ts`, which parses the real
 * stylesheet and fails when a token here no longer matches the one the interface
 * uses.
 *
 * WHAT THE DESIGN DELIBERATELY DOES NOT DO.
 *
 *   * No images, anywhere. Not a logo, not a spacer, not a tracking pixel. Most
 *     clients block remote images by default, so an email whose branding is an
 *     image is an email that arrives blank — and a tracking pixel in a password
 *     reset is a thing we are not going to do.
 *   * No web fonts. They do not load in Outlook or Gmail and the fallback is
 *     what most people would have seen anyway.
 *   * No dark-mode variant. Client support ranges from correct (Apple Mail)
 *     through partial (Outlook.com inverts some colours and not others) to
 *     absent, and a half-inverted card is less readable than a light one. The
 *     `color-scheme: light` meta asks clients not to invent one.
 *   * No `<style>` block. Gmail strips it when a message is clipped, which is
 *     exactly when a long email most needs its layout. Everything is inline.
 *   * `--color-ink-subtle` (#888e94) is never used for text here. It reaches
 *     3.4:1 on white, which is below WCAG AA for body copy, and email footers
 *     are small to begin with. Footnotes use ink-muted at 6.3:1.
 */

/* -------------------------------------------------------------------------- */
/* Tokens — mirrored from src/styles/index.css, enforced by a test.            */
/* -------------------------------------------------------------------------- */

export const EMAIL_TOKENS = {
  canvas: '#f7f7f5',
  surface: '#ffffff',
  line: '#e6e6e2',
  lineSoft: '#f4f4f2',
  ink: '#16181a',
  inkMuted: '#5b6167',
  inkInverse: '#ffffff',
  brand: '#22664f',
  brandSoft: '#eef6f2',
} as const

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/* -------------------------------------------------------------------------- */
/* Document model                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A run of text inside a paragraph.
 *
 * Paragraphs are built from segments rather than from a string of HTML so that
 * emphasis is possible without any call site ever handing raw markup to the
 * renderer. Every segment is escaped on the way out, so an agency called
 * `<img onerror=...>` is text in every message this product signs its name to.
 */
export type Inline = string | { readonly strong: string }

export type Paragraph = readonly Inline[]

export interface EmailAction {
  readonly label: string
  readonly url: string
}

export interface EmailDocument {
  /**
   * The line the inbox shows beside the subject.
   *
   * Without one, clients scrape the first words of the body, which for a
   * table-based layout is often nothing at all — so the preview reads as an
   * empty message. It is rendered hidden, and padded, because several clients
   * continue scraping past a short preheader straight into the markup.
   */
  readonly preheader: string
  readonly paragraphs: readonly Paragraph[]
  readonly action?: EmailAction
  /** A one-time code, shown when the message carries one instead of a link. */
  readonly code?: string
  /** Smaller text under the action: expiry, "ignore this if…", and so on. */
  readonly footnotes?: readonly Paragraph[]
}

/* -------------------------------------------------------------------------- */
/* Escaping                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * HTML escaping.
 *
 * Note what this deliberately leaves alone: `{`, `}` and `.`, which means a
 * GoTrue placeholder like `{{ .ConfirmationURL }}` survives being passed through
 * as an ordinary value. That is what lets one renderer produce both our own
 * messages, where every value is attacker-controlled text, and the auth
 * templates, where the value is a Go template expression that must reach the
 * file intact.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderInline(segment: Inline): string {
  if (typeof segment === 'string') return escapeHtml(segment)
  return `<strong style="font-weight:600;">${escapeHtml(segment.strong)}</strong>`
}

function renderParagraph(paragraph: Paragraph): string {
  return paragraph.map(renderInline).join('')
}

function paragraphToText(paragraph: Paragraph): string {
  return paragraph
    .map((segment) => (typeof segment === 'string' ? segment : segment.strong))
    .join('')
}

/* -------------------------------------------------------------------------- */
/* HTML                                                                       */
/* -------------------------------------------------------------------------- */

const T = EMAIL_TOKENS

/**
 * The hidden preview line.
 *
 * The run of zero-width non-joiners is not decoration. Clients that scrape a
 * preview take a fixed number of characters, and without padding they carry on
 * past the preheader and show whatever markup comes next.
 */
function preheaderBlock(text: string): string {
  const padding = '&#8204;&nbsp;'.repeat(60)
  return (
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;` +
    `font-size:1px;line-height:1px;color:${T.canvas};opacity:0;">` +
    `${escapeHtml(text)}${padding}</div>`
  )
}

/**
 * The call to action.
 *
 * A table rather than a styled anchor, because Outlook's Word rendering engine
 * ignores padding on an inline element and would otherwise produce a bare link
 * where the button should be. The corners go square there; that is the whole
 * cost, and it is cheaper than carrying VML.
 */
function actionBlock(action: EmailAction): string {
  const href = escapeHtml(action.url)
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 4px 0;">
        <tr><td style="background:${T.brand};border-radius:8px;">
          <a href="${href}" style="display:inline-block;padding:12px 22px;font-family:${FONT_STACK};font-size:15px;font-weight:600;line-height:20px;color:${T.inkInverse};text-decoration:none;border-radius:8px;">${escapeHtml(action.label)}</a>
        </td></tr>
      </table>`
}

/** A one-time code, spaced so it can be read aloud and copied in one go. */
function codeBlock(code: string): string {
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
        <tr><td style="background:${T.brandSoft};border:1px solid ${T.line};border-radius:8px;padding:14px 20px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:26px;font-weight:600;letter-spacing:0.18em;color:${T.ink};">${escapeHtml(code)}</td></tr>
      </table>`
}

/**
 * The whole message.
 *
 * `role="presentation"` on every layout table is what stops a screen reader
 * announcing a four-cell grid before reading a two-sentence email.
 */
export function renderEmailHtml(document: EmailDocument): string {
  const body = document.paragraphs
    .map(
      (paragraph, index) =>
        `<p style="margin:0 0 ${index === document.paragraphs.length - 1 ? '22' : '14'}px 0;font-size:15px;line-height:23px;color:${T.ink};">${renderParagraph(paragraph)}</p>`,
    )
    .join('\n      ')

  const action = document.action ? actionBlock(document.action) : ''
  const code = document.code ? codeBlock(document.code) : ''

  const footnotes = (document.footnotes ?? [])
    .map(
      (paragraph) =>
        `<p style="margin:18px 0 0 0;font-size:13px;line-height:20px;color:${T.inkMuted};">${renderParagraph(paragraph)}</p>`,
    )
    .join('\n      ')

  const fallback = document.action
    ? `
    <tr><td style="padding:16px 28px 24px 28px;border-top:1px solid ${T.lineSoft};">
      <p style="margin:0;font-size:12px;line-height:18px;color:${T.inkMuted};word-break:break-all;">
        If the button does not work, copy this link into your browser:<br>${escapeHtml(document.action.url)}
      </p>
    </td></tr>`
    : ''

  /*
   * Whitespace-only lines are collapsed on the way out. They appear wherever an
   * optional block (the code, the action) is absent, and these files are
   * committed and reviewed like source, so they should not carry the shape of
   * the branches that produced them.
   */
  return normalize(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:${T.canvas};">
${preheaderBlock(document.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.canvas};">
  <tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto;font-family:${FONT_STACK};">

    <tr><td style="padding:0 4px 12px 4px;">
      <span style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:${T.brand};">${escapeHtml(PRODUCT_NAME)}</span>
    </td></tr>

    <tr><td style="background:${T.surface};border:1px solid ${T.line};border-radius:12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:28px 28px 24px 28px;">
      ${body}
      ${code}${action}
      ${footnotes}
        </td></tr>${fallback}
      </table>
    </td></tr>

    <tr><td style="padding:16px 4px 0 4px;">
      <p style="margin:0;font-size:12px;line-height:18px;color:${T.inkMuted};">
        Sent by ${escapeHtml(PRODUCT_NAME)}.
      </p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`)
}

/** Drops whitespace-only lines and any trailing spaces, leaving the rest alone. */
function normalize(html: string): string {
  return html
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : line.replace(/\s+$/, '')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/* -------------------------------------------------------------------------- */
/* Plain text                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The text alternative, from the same document.
 *
 * Built here rather than written by hand at each call site, because a text part
 * that says something different from the HTML part is a real failure and an
 * invisible one: almost nobody reads it, so nobody notices when it still carries
 * last year's wording — except the spam filters, which read both and score a
 * mismatch.
 */
export function renderEmailText(document: EmailDocument): string {
  const lines: string[] = []

  for (const paragraph of document.paragraphs) {
    lines.push(paragraphToText(paragraph), '')
  }

  if (document.code) lines.push(document.code, '')

  if (document.action) {
    lines.push(`${document.action.label}:`, document.action.url, '')
  }

  for (const paragraph of document.footnotes ?? []) {
    lines.push(paragraphToText(paragraph))
  }

  lines.push('', `Sent by ${PRODUCT_NAME}.`)

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* -------------------------------------------------------------------------- */
/* Brand                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The product, as somebody reading an email sees it.
 *
 * Duplicated from `src/lib/config/brand.ts` for the Deno/Vite reason given at
 * the top of this file, and held in step by a test rather than by discipline.
 *
 * NOTE WHAT IS NOT HERE: the publisher credit. `PRODUCT_BRAND.creator` belongs
 * on surfaces that are about the software — the sign-in screens, the README,
 * PDF metadata. A password reset is a transactional message to somebody trying
 * to get back into their own account, and a corporate byline on it is noise.
 */
export const PRODUCT_NAME = 'Pevvy'
