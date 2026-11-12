import { z } from 'zod'

import { isValidTimeZone } from '@/lib/datetime/timezone'
import { isValidCurrencyCode } from '@/lib/money/money'

/**
 * Validation is defence in depth, not the only defence: the same rules exist as
 * CHECK constraints in the schema. These exist so a person gets a useful message
 * on the field they are typing in, rather than a round trip and a database error.
 */

const email = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .max(320, 'That email address is too long.')
  .email('Enter a valid email address, like name@agency.com.')

/**
 * Supabase enforces a minimum of 6 characters by default. Eight is required
 * here because this account can hold an agency's entire financial record.
 */
const password = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Passwords cannot be longer than 72 characters.')

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
})

export type SignInInput = z.infer<typeof signInSchema>

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your name.').max(120, 'That name is too long.'),
    email,
    password,
    confirmPassword: z.string(),
    organizationName: z
      .string()
      .trim()
      .min(2, 'Enter your agency name.')
      .max(120, 'That name is too long.'),
    countryCode: z.string().length(2, 'Choose a country.'),
    defaultCurrency: z.string().refine(isValidCurrencyCode, 'Choose a currency.'),
    timeZone: z.string().refine(isValidTimeZone, 'Choose a time zone.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Both passwords must match.',
    path: ['confirmPassword'],
  })

export type SignUpInput = z.infer<typeof signUpSchema>

export const forgotPasswordSchema = z.object({ email })
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Both passwords must match.',
    path: ['confirmPassword'],
  })

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export const createOrganizationSchema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(2, 'Enter your agency name.')
    .max(120, 'That name is too long.'),
  countryCode: z.string().length(2, 'Choose a country.'),
  defaultCurrency: z.string().refine(isValidCurrencyCode, 'Choose a currency.'),
  timeZone: z.string().refine(isValidTimeZone, 'Choose a time zone.'),
})

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>

/**
 * The six digits an authenticator app shows. Apps display them as "123 456", so
 * spaces are dropped before the check rather than rejected.
 */
export const totpCodeSchema = z.object({
  code: z
    .string()
    .transform((value) => value.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your app.')),
})

export type TotpCodeInput = z.infer<typeof totpCodeSchema>

/**
 * Recovery codes are ten characters of Crockford base32, which has no I, L, O or
 * U. A code copied by hand is often typed with those read as 1 and 0, in lower
 * case, or split with a space or hyphen; the server compares exactly, so all of
 * that is tidied here.
 */
export function normaliseRecoveryCode(value: string): string {
  return value
    .replace(/[\s-]+/g, '')
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
}

export const recoveryCodeSchema = z.object({
  code: z
    .string()
    .transform(normaliseRecoveryCode)
    .pipe(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{10}$/, 'Enter the 10-character recovery code.')),
})

export type RecoveryCodeInput = z.infer<typeof recoveryCodeSchema>
