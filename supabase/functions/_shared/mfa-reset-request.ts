/**
 * The decisions at the factor-reset boundary, kept out of the entrypoint so they
 * can be tested: what a request body must look like, and whether the caller's
 * session is strong enough for the mode they asked for.
 *
 * Nothing here reads a request, a client or the environment.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ResetMode = 'self' | 'member'

export type ResetRequest =
  | { readonly mode: 'self'; readonly recoveryCode: string }
  | {
      readonly mode: 'member'
      readonly subjectUserId: string
      readonly organizationId: string
    }

export type ParsedResetRequest =
  | { readonly ok: true; readonly request: ResetRequest }
  | { readonly ok: false; readonly message: string }

/** Validates an untrusted, already-JSON-parsed body. Never throws. */
export function parseResetRequest(body: unknown): ParsedResetRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, message: 'That request could not be read.' }
  }
  const fields = body as Record<string, unknown>

  if (fields.mode === 'self') {
    const recoveryCode = fields.recoveryCode
    if (typeof recoveryCode !== 'string' || recoveryCode === '') {
      return { ok: false, message: 'No recovery code was given.' }
    }
    return { ok: true, request: { mode: 'self', recoveryCode } }
  }

  if (fields.mode === 'member') {
    const { subjectUserId, organizationId } = fields
    if (
      typeof subjectUserId !== 'string' ||
      typeof organizationId !== 'string' ||
      !UUID.test(subjectUserId) ||
      !UUID.test(organizationId)
    ) {
      return { ok: false, message: 'A member and an agency must be named.' }
    }
    return { ok: true, request: { mode: 'member', subjectUserId, organizationId } }
  }

  return { ok: false, message: 'Unknown mode.' }
}

/**
 * The aal claim of the Bearer token in an Authorization header.
 *
 * ONLY CALL THIS ON A TOKEN THAT auth.getUser() HAS ALREADY VERIFIED: the payload
 * is decoded, not signature-checked, here.
 *
 * Returns '' when the payload has no string `aal`. THROWS a fixed, content-free
 * error when the header or token cannot be decoded at all; the caller treats that
 * as a refusal.
 */
export function readAalClaim(authorizationHeader: string): string {
  try {
    const token = authorizationHeader.replace(/^Bearer\s+/i, '')
    const payload = token.split('.')[1]
    if (payload === undefined || payload === '') throw new Error('no payload')
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded)) as { aal?: unknown } | null
    return typeof claims?.aal === 'string' ? claims.aal : ''
  } catch {
    throw new Error('unreadable_aal_claim')
  }
}

/**
 * Whether the session may use this mode.
 *
 * 'self' works at any aal: it is the path for someone who has lost their
 * authenticator and cannot produce a second factor. 'member' (an owner acting on
 * someone else) requires aal2; anything other than exactly 'aal2' is refused.
 * The claim is read only for 'member', and a throw from readAalClaim propagates.
 */
export function hasRequiredAal(mode: ResetMode, authorizationHeader: string): boolean {
  if (mode === 'self') return true
  return readAalClaim(authorizationHeader) === 'aal2'
}
