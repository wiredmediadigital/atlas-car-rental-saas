// @vitest-environment node
/**
 * The auth templates, and the seam they sit on.
 *
 * This file is both the check and the generator. GoTrue reads real files from
 * `supabase/templates/`, so those files have to be committed — and a committed
 * build artefact is a copy that can rot. Running the suite compares each file
 * with what `auth-emails.ts` produces and fails on any difference; running it
 * with `UPDATE_EMAIL_TEMPLATES=1` rewrites them instead:
 *
 *     UPDATE_EMAIL_TEMPLATES=1 npx vitest run supabase/tests/email-templates.test.ts
 *
 * So `npm run verify` is the thing that stops the password reset and the team
 * invitation drifting apart, which is the entire reason the layout was extracted
 * in the first place.
 *
 * The rest of the file asserts the properties that make an email survive
 * contact with a real mail client — the ones that are invisible until somebody
 * opens the message in Outlook and finds a blank card.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PRODUCT_BRAND } from '@/lib/config/brand'

import {
  AUTH_EMAIL_TEMPLATES,
  renderAuthTemplate,
  renderAuthTemplateText,
} from '../functions/_shared/auth-emails.ts'
import { EMAIL_TOKENS, PRODUCT_NAME, renderEmailHtml } from '../functions/_shared/email-layout.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')
const templatesDir = join(repoRoot, 'supabase', 'templates')
const stylesheet = join(repoRoot, 'src', 'styles', 'index.css')

const isUpdating = process.env.UPDATE_EMAIL_TEMPLATES === '1'

describe('the generated auth templates', () => {
  if (isUpdating) {
    it('writes every template to disk', () => {
      mkdirSync(templatesDir, { recursive: true })
      for (const template of AUTH_EMAIL_TEMPLATES) {
        writeFileSync(join(templatesDir, template.file), renderAuthTemplate(template), 'utf8')
      }
      expect(AUTH_EMAIL_TEMPLATES.length).toBeGreaterThan(0)
    })
    return
  }

  it.each(AUTH_EMAIL_TEMPLATES.map((template) => [template.file, template] as const))(
    '%s is what auth-emails.ts produces',
    (file, template) => {
      const path = join(templatesDir, file)

      expect(
        existsSync(path),
        `${file} is missing. Regenerate with UPDATE_EMAIL_TEMPLATES=1.`,
      ).toBe(true)

      expect(
        readFileSync(path, 'utf8'),
        `${file} has drifted from auth-emails.ts. Edit the document there, not the HTML, then regenerate with UPDATE_EMAIL_TEMPLATES=1.`,
      ).toBe(renderAuthTemplate(template))
    },
  )

  it('leaves no template file behind that nothing generates', () => {
    // A renamed template whose old file stays on disk is a file config.toml may
    // still be pointing at — a stale message that no test covers any more.
    const generated = AUTH_EMAIL_TEMPLATES.map((template) => template.file)
    const onDisk = existsSync(templatesDir)
      ? readdirSync(templatesDir).filter((name) => name.endsWith('.html'))
      : []

    expect([...onDisk].sort()).toEqual([...generated].sort())
  })
})

describe('what every outgoing message has to do to survive a mail client', () => {
  const rendered = AUTH_EMAIL_TEMPLATES.map(
    (template) => [template.file, renderAuthTemplate(template)] as const,
  )

  it.each(rendered)('%s loads nothing from the network', (_file, html) => {
    /*
     * No <img>, no remote CSS, no font. Most clients block remote images by
     * default, so branding that lives in an image is branding that arrives
     * blank — and a remote request in a password reset is a read receipt on
     * somebody's security event, whether or not it was meant as one.
     */
    expect(html).not.toMatch(/<img\b/i)
    expect(html).not.toMatch(/<link\b/i)
    expect(html).not.toMatch(/url\(/i)
    expect(html).not.toMatch(/https?:\/\//)
  })

  it.each(rendered)('%s carries no <style> block', (_file, html) => {
    // Gmail drops it when a message is clipped, which is exactly when a long
    // email most needs its layout.
    expect(html).not.toMatch(/<style\b/i)
  })

  it.each(rendered)('%s has a preview line the inbox can show', (_file, html) => {
    expect(html).toMatch(/display:none;max-height:0/)
  })

  it.each(rendered)('%s marks its layout tables as presentation', (_file, html) => {
    const tables = html.match(/<table\b[^>]*>/g) ?? []
    expect(tables.length).toBeGreaterThan(0)
    for (const table of tables) {
      expect(table, `a table without role="presentation": ${table}`).toContain(
        'role="presentation"',
      )
    }
  })

  it.each(rendered)('%s never uses ink-subtle for text', (_file, html) => {
    // #888e94 reaches 3.4:1 on white, under the 4.5:1 AA floor for body copy,
    // and an email footer is small text to begin with.
    expect(html).not.toContain('#888e94')
  })

  it.each(rendered)('%s declares a light colour scheme and a language', (_file, html) => {
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('name="color-scheme" content="light"')
  })
})

describe('the GoTrue placeholders', () => {
  it.each(
    AUTH_EMAIL_TEMPLATES.filter((template) => template.document.action).map(
      (template) => [template.file, template] as const,
    ),
  )('%s passes its confirmation URL through unescaped', (_file, template) => {
    const html = renderAuthTemplate(template)
    const url = template.document.action!.url

    // The whole trick: escapeHtml touches only & < > " ', none of which appear
    // in a Go template expression, so the placeholder reaches the file intact.
    expect(html).toContain(url)
    expect(html).not.toContain('&amp;amp;')
    expect(html).not.toMatch(/\{\{\s*&/)
  })

  it('substitutes both addresses into the email-change message', () => {
    const template = AUTH_EMAIL_TEMPLATES.find((t) => t.file === 'email_change.html')
    expect(template).toBeDefined()

    const html = renderAuthTemplate(template!)
    expect(html).toContain('{{ .Email }}')
    expect(html).toContain('{{ .NewEmail }}')
    // Sent to both addresses, so it must read correctly from either end.
    expect(html).toMatch(/both/i)
  })

  it('gives the reauthentication code and no link to click', () => {
    const template = AUTH_EMAIL_TEMPLATES.find((t) => t.file === 'reauthentication.html')!
    expect(renderAuthTemplate(template)).toContain('{{ .Token }}')
    expect(template.document.action).toBeUndefined()
  })

  it('gives the password-change notice nothing to click at all', () => {
    // A security notice with a prominent button is the shape of the phishing
    // email it would be teaching people to trust.
    const template = AUTH_EMAIL_TEMPLATES.find(
      (t) => t.file === 'password_changed_notification.html',
    )!
    expect(template.document.action).toBeUndefined()
    expect(renderAuthTemplate(template)).not.toContain('<a href')
  })
})

describe('the text alternative', () => {
  it.each(AUTH_EMAIL_TEMPLATES.map((template) => [template.file, template] as const))(
    '%s says the same thing in plain text',
    (_file, template) => {
      const text = renderAuthTemplateText(template)

      expect(text).toContain(PRODUCT_NAME)
      expect(text).not.toMatch(/<[a-z]/i)
      if (template.document.action) expect(text).toContain(template.document.action.url)
      if (template.document.code) expect(text).toContain(template.document.code)
    },
  )
})

describe('the copied design tokens', () => {
  /*
   * email-layout.ts cannot import src/styles/index.css — it runs on Deno inside
   * an Edge Function and that file is a Tailwind theme block consumed by Vite.
   * So the tokens are copied, and this is what stops the copy rotting: a
   * redesign that moves the brand colour and forgets the emails fails here
   * rather than six months later in somebody's inbox.
   */
  const css = readFileSync(stylesheet, 'utf8')

  function token(name: string): string {
    const value = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{3,8})`, 'i'))?.[1]
    if (value === undefined) {
      throw new Error(
        `--color-${name} is no longer in src/styles/index.css. The token moved or was ` +
          `renamed; update EMAIL_TOKENS and this mapping together.`,
      )
    }
    return value.toLowerCase()
  }

  it.each([
    ['canvas', 'canvas'],
    ['surface', 'surface'],
    ['line', 'line'],
    ['lineSoft', 'surface-inset'],
    ['ink', 'ink'],
    ['inkMuted', 'ink-muted'],
    ['inkInverse', 'ink-inverse'],
    ['brand', 'brand-600'],
    ['brandSoft', 'brand-50'],
  ] as const)('%s still matches --color-%s in the stylesheet', (key, cssName) => {
    expect(EMAIL_TOKENS[key].toLowerCase()).toBe(token(cssName))
  })

  it('names the product the same way the interface does', () => {
    expect(PRODUCT_NAME).toBe(PRODUCT_BRAND.name)
  })
})

describe('escaping, on the one path where the values are somebody else’s text', () => {
  it('cannot be made to write markup into a message', () => {
    const html = renderEmailHtml({
      preheader: '</div><script>alert(1)</script>',
      paragraphs: [['Welcome to ', { strong: '<img src=x onerror=alert(1)>' }, '.']],
      action: { label: '"><script>alert(1)</script>', url: 'https://app.example.test/x?a=1&b=2' },
      footnotes: [['<b>not bold</b>']],
    })

    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>not bold</b>')
    // The ampersand in a real URL still has to survive as one.
    expect(html).toContain('a=1&amp;b=2')
  })
})
