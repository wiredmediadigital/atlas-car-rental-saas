/**
 * The messages Supabase's auth service sends, written here rather than there.
 *
 * GoTrue renders Go `html/template` files from disk. It cannot call the layout
 * module next to this file, so these seven documents are defined here and
 * COMPILED into `supabase/templates/*.html` by `supabase/tests/email-templates.test.ts`,
 * which fails when a committed file is not what this module produces. Running
 * that test with `UPDATE_EMAIL_TEMPLATES=1` rewrites them.
 *
 * That indirection buys one thing: the password reset and the team invitation
 * cannot drift apart, because both are rendered by `renderEmailHtml` from the
 * same tokens.
 *
 * WHY THE UNREACHABLE ONES ARE HERE TOO. Magic link, email change and
 * reauthentication are not wired to anything in the application today. They are
 * one dashboard toggle away from being wired, and the day somebody flips that
 * toggle is not the day to discover that Supabase's stock template goes out
 * under this product's name. They cost nothing to carry.
 *
 * A NOTE ON THE PLACEHOLDERS. `{{ .ConfirmationURL }}` and friends are Go
 * template expressions that must reach the file intact. They survive
 * `escapeHtml` because it touches only `& < > " '`, none of which appear in
 * them — so they can be passed through the ordinary renderer as if they were
 * text. GoTrue escapes the values it substitutes, so this is not a hole.
 */

import {
  renderEmailHtml,
  renderEmailText,
  type EmailDocument,
  PRODUCT_NAME,
} from './email-layout.ts'

/** GoTrue's substitutions, named once so a typo is a compile error. */
const CONFIRMATION_URL = '{{ .ConfirmationURL }}'
const TOKEN = '{{ .Token }}'
const SITE_URL = '{{ .SiteURL }}'
const OLD_EMAIL = '{{ .Email }}'
const NEW_EMAIL = '{{ .NewEmail }}'

export interface AuthEmailTemplate {
  /** The file GoTrue reads, under `supabase/templates/`. */
  readonly file: string
  /** The subject line, which belongs in config.toml beside the path. */
  readonly subject: string
  /** Why this message exists, for whoever edits it next. */
  readonly note: string
  readonly document: EmailDocument
}

export const AUTH_EMAIL_TEMPLATES: readonly AuthEmailTemplate[] = [
  {
    file: 'confirmation.html',
    subject: `Confirm your email address`,
    note: 'Sent on signup while auth.email.enable_confirmations is true, and again by the "resend" control on the confirm-email page.',
    document: {
      preheader: `Confirm your address to finish setting up your ${PRODUCT_NAME} account.`,
      paragraphs: [
        [`Confirm this email address to finish setting up your ${PRODUCT_NAME} account.`],
      ],
      action: { label: 'Confirm email address', url: CONFIRMATION_URL },
      footnotes: [
        [
          'If you did not create an account, you can ignore this message. Nothing is created until the address is confirmed.',
        ],
      ],
    },
  },

  {
    file: 'recovery.html',
    subject: `Reset your ${PRODUCT_NAME} password`,
    note: 'Sent by resetPasswordForEmail from the sign-in screen.',
    document: {
      preheader: `Choose a new password for your ${PRODUCT_NAME} account.`,
      paragraphs: [['Somebody asked to reset the password for this account.']],
      action: { label: 'Choose a new password', url: CONFIRMATION_URL },
      footnotes: [
        [
          'This link can be used once, and expires an hour after it was sent. If you did not ask for it, you can ignore this message — your password has not changed.',
        ],
      ],
    },
  },

  {
    file: 'magic_link.html',
    subject: `Your ${PRODUCT_NAME} sign-in link`,
    note: 'Not reachable from the application today — there is no signInWithOtp call. Carried so that enabling it never sends a stock template.',
    document: {
      preheader: `Your single-use link to sign in to ${PRODUCT_NAME}.`,
      paragraphs: [[`Use this link to sign in to ${PRODUCT_NAME}.`]],
      action: { label: `Sign in to ${PRODUCT_NAME}`, url: CONFIRMATION_URL },
      footnotes: [
        [
          'The link works once and expires an hour after it was sent. If you did not ask to sign in, you can ignore this message — nobody can use the link but you.',
        ],
      ],
    },
  },

  {
    file: 'invite.html',
    subject: `You have been invited to ${PRODUCT_NAME}`,
    note: 'GoTrue\'s own invite, which is NOT how this product invites colleagues — team invitations go through the team-invitations function. Reachable only from the Supabase dashboard\'s "Invite user" button.',
    document: {
      preheader: `You have been invited to create a ${PRODUCT_NAME} account.`,
      paragraphs: [
        [`You have been invited to create an account on `, { strong: PRODUCT_NAME }, `.`],
        [
          `${PRODUCT_NAME} is the system a car rental agency uses to run its fleet, contracts and finances.`,
        ],
      ],
      action: { label: 'Accept the invitation', url: CONFIRMATION_URL },
      footnotes: [
        [
          'If you were not expecting this, you can ignore the message — nothing happens until you accept.',
        ],
      ],
    },
  },

  {
    /*
     * With `double_confirm_changes = true` — the setting this project ships —
     * GoTrue sends this same template to BOTH the old address and the new one.
     * The wording therefore has to be true read from either end, which is why it
     * names both addresses and says "confirm this change" rather than "confirm
     * your new address". A template that assumed the new recipient would read as
     * nonsense to the person being told their address is being taken away, who
     * is exactly the person most likely to need to act on it.
     */
    file: 'email_change.html',
    subject: `Confirm the change of email address`,
    note: 'Sent to BOTH addresses while auth.email.double_confirm_changes is true. Not reachable from the application today.',
    document: {
      preheader: `Confirm the change of email address on your ${PRODUCT_NAME} account.`,
      paragraphs: [
        [
          `A request was made to change the email address on a ${PRODUCT_NAME} account from `,
          { strong: OLD_EMAIL },
          ' to ',
          { strong: NEW_EMAIL },
          '.',
        ],
        ['This message has been sent to both addresses, and both must confirm.'],
      ],
      action: { label: 'Confirm this change', url: CONFIRMATION_URL },
      footnotes: [
        [
          'If you did not ask for this, do not confirm it, and change your password — the address stays as it is unless both confirm.',
        ],
      ],
    },
  },

  {
    file: 'reauthentication.html',
    subject: `Your ${PRODUCT_NAME} confirmation code`,
    note: 'Sent when a sensitive action requires confirming identity. Not reachable today: auth.email.secure_password_change is false.',
    document: {
      preheader: `Your confirmation code for ${PRODUCT_NAME}.`,
      paragraphs: [['Enter this code to confirm it is you.']],
      code: TOKEN,
      footnotes: [
        [
          'The code expires an hour after it was sent. If you did not ask for it, you can ignore this message.',
        ],
      ],
    },
  },

  {
    /*
     * The one message with no action button. There is nothing to click, because
     * everything it reports has already happened — and a password-change notice
     * carrying a prominent link is the exact shape of the phishing email it
     * would be teaching people to trust.
     */
    file: 'password_changed_notification.html',
    subject: `Your ${PRODUCT_NAME} password was changed`,
    note: 'A notification, not a request. Enabled under [auth.email.notification.password_changed].',
    document: {
      preheader: `The password on your ${PRODUCT_NAME} account was changed.`,
      paragraphs: [
        ['The password on this account was changed.'],
        ['If that was you, there is nothing to do.'],
      ],
      footnotes: [
        [
          'If it was not you, reset your password straight away at ',
          { strong: SITE_URL },
          ' and contact whoever administers your agency.',
        ],
      ],
    },
  },
]

/** The file GoTrue reads, for one template. */
export function renderAuthTemplate(template: AuthEmailTemplate): string {
  return renderEmailHtml(template.document)
}

/**
 * The plain-text alternative.
 *
 * Exported for the tests rather than for GoTrue, which sends HTML only. It is
 * still worth asserting that every auth message HAS a coherent text rendering:
 * the day one of these moves to a transport that sends both parts, the copy is
 * already there and already says the same thing.
 */
export function renderAuthTemplateText(template: AuthEmailTemplate): string {
  return renderEmailText(template.document)
}
