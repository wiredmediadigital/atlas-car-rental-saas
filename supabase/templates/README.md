# Outgoing email

Everything this product sends, and how to make it send.

## The files here are generated

Do not edit the HTML. The design lives in `supabase/functions/_shared/email-layout.ts`
and the wording in `supabase/functions/_shared/auth-emails.ts`. Change those, then:

```bash
UPDATE_EMAIL_TEMPLATES=1 npx vitest run supabase/tests/email-templates.test.ts
```

`npm run verify` fails if a committed file no longer matches its source, which is what
stops the password reset and the team invitation drifting apart.

## What gets sent, and by whom

Eight messages, from two systems that cannot share code — GoTrue renders Go templates
from disk, our Edge Functions render TypeScript. One design, rendered twice.

| Message                             | Sent by                     | Template                             |
| ----------------------------------- | --------------------------- | ------------------------------------ |
| Confirm your email address          | GoTrue                      | `confirmation.html`                  |
| Reset your Pevvy password           | GoTrue                      | `recovery.html`                      |
| Your Pevvy password was changed     | GoTrue                      | `password_changed_notification.html` |
| Your Pevvy sign-in link             | GoTrue                      | `magic_link.html` ¹                  |
| You have been invited to Pevvy      | GoTrue                      | `invite.html` ¹                      |
| Confirm the change of email address | GoTrue                      | `email_change.html` ¹                |
| Your Pevvy confirmation code        | GoTrue                      | `reauthentication.html` ¹            |
| Join _agency_ on Pevvy              | `team-invitations` function | `_shared/team-email.ts`              |

¹ Not reachable from the application today. Carried so that enabling the flow never
sends a stock Supabase template under this product's name.

## Setting it up on the hosted project

Three separate things, none of which the other two imply.

### 1. SMTP, so auth email sends at all

Supabase's built-in SMTP is a development convenience: a few messages an hour, from
Supabase's own sender address. It will throttle on the first real signup day.

**Dashboard → Project Settings → Authentication → SMTP Settings**

| Field        | Value                             |
| ------------ | --------------------------------- |
| Host         | `smtp.resend.com`                 |
| Port         | `587`                             |
| Username     | `resend`                          |
| Password     | your Resend API key               |
| Sender email | `no-reply@<your verified domain>` |
| Sender name  | `Pevvy`                           |

### 2. The templates themselves

`config.toml` configures **local development only** — the hosted project reads its
templates from the Dashboard. Paste each file's contents into the matching editor and
set the subject beside it.

**Dashboard → Authentication → Emails**

| Dashboard template   | File                    | Subject                             |
| -------------------- | ----------------------- | ----------------------------------- |
| Confirm signup       | `confirmation.html`     | Confirm your email address          |
| Reset password       | `recovery.html`         | Reset your Pevvy password           |
| Magic link           | `magic_link.html`       | Your Pevvy sign-in link             |
| Invite user          | `invite.html`           | You have been invited to Pevvy      |
| Change email address | `email_change.html`     | Confirm the change of email address |
| Reauthentication     | `reauthentication.html` | Your Pevvy confirmation code        |

**The seventh has no Dashboard control.** `password_changed_notification.html` is gated
on `mailer_notifications_password_changed_enabled`, a project-level setting that exists
only in `config.toml` and the Management API. Six templates can be pasted in by hand and
the seventh simply will not send, which is a confusing way to discover this.

Do **not** reach for `supabase config push` to fix it. That uploads this whole
`config.toml` — which is local-development configuration, `site_url` included — and
would replace the live site URL and redirect allow-list with a laptop's. The warning is
at the top of `[auth]` in that file.

Use the Management API instead, which touches only the fields it names:

```bash
# A personal access token from https://supabase.com/dashboard/account/tokens
export SUPABASE_ACCESS_TOKEN="sbp_..."      # PowerShell: $env:SUPABASE_ACCESS_TOKEN = "sbp_..."

npm run email:push            # dry run — prints exactly what would change
npm run email:push -- --apply # sends it
```

That pushes all seven templates and their subjects as well as the notification flag, so
it also replaces the manual pasting above. After changing any wording: `npm run
email:build`, then `npm run email:push -- --apply`.

The token has full control of your projects. Set it in your shell, never in a file, and
revoke it when you are done.

### 3. The team invitation transport

Separate from all of the above, because it does not go through GoTrue. Until these are
set, `deliverInvitation` returns `not_configured`, **no invitation email is sent**, and
the Team page correctly reports that an administrator must pass the link on by hand.

```bash
npx supabase secrets set \
  TEAM_APP_URL="https://<your app domain>" \
  TEAM_EMAIL_PROVIDER="resend" \
  TEAM_EMAIL_API_KEY="<your Resend API key>" \
  TEAM_EMAIL_FROM="Pevvy <no-reply@<your verified domain>>"
```

`TEAM_APP_URL` is where invitation links point. It is read from server configuration
and never from a request header — honouring a `Host` header here would turn every
invitation into an open redirect carrying a bearer token.

## Checking it

Send yourself a password reset and an invitation, then read both in a client that is
not the one you built them in. The things worth looking at:

- The preview line in the inbox list, before opening anything.
- Outlook on Windows, where the button corners go square — expected, and the reason
  the button is a table rather than a styled anchor.
- Dark mode, which these deliberately do not implement; the design forces light rather
  than let a client half-invert a card.

## Design constraints worth not undoing

- **No images, anywhere.** Not a logo, not a tracking pixel. Remote images are blocked
  by default in most clients, so image-based branding arrives blank — and a tracking
  pixel in a password reset is a read receipt on somebody's security event.
- **No `<style>` block.** Gmail strips it when a message is clipped.
- **`--color-ink-subtle` is never used for text**, here or in `email-layout.ts`. It
  reaches 3.4:1 on white, below the 4.5:1 AA floor, and these footers are small already.
- **The password-changed notice has no button.** A security notice carrying a prominent
  link is the shape of the phishing email it would be teaching people to trust.
