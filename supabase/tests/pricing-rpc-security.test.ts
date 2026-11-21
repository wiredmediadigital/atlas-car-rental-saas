// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TestDatabase } from './support/harness'

let db: TestDatabase

beforeAll(async () => {
  db = await TestDatabase.create()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('pricing catalogue service RPC boundary', () => {
  it('exposes only the service-role execution grant', async () => {
    const [row] = await db.sql<{
      public_role: boolean
      anon: boolean
      authenticated: boolean
      service_role: boolean
    }>(
      `select has_function_privilege('public', 'public.billing_replace_catalogue_service(jsonb)', 'EXECUTE') as public_role,
              has_function_privilege('anon', 'public.billing_replace_catalogue_service(jsonb)', 'EXECUTE') as anon,
              has_function_privilege('authenticated', 'public.billing_replace_catalogue_service(jsonb)', 'EXECUTE') as authenticated,
              has_function_privilege('service_role', 'public.billing_replace_catalogue_service(jsonb)', 'EXECUTE') as service_role`,
    )
    expect(row).toEqual({
      public_role: false,
      anon: false,
      authenticated: false,
      service_role: true,
    })
  })

  it('keeps the public wrapper invoker-safe and search-path pinned', async () => {
    const [row] = await db.sql<{
      security_definer: boolean
      config: string[] | null
      owner: string
    }>(
      `select p.prosecdef as security_definer,
              p.proconfig as config,
              r.rolname as owner
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join pg_roles r on r.oid = p.proowner
        where n.nspname = 'public'
          and p.proname = 'billing_replace_catalogue_service'`,
    )
    expect(row?.security_definer).toBe(false)
    expect(row?.config).toContain('search_path=""')
    expect(row?.owner).toBe('postgres')
  })

  it('delegates to the existing app function without exposing app functions', async () => {
    const [row] = await db.sql<{ wrapper_body: string; app_usage: boolean }>(
      `select pg_get_functiondef(p.oid) as wrapper_body,
              has_schema_privilege('service_role', 'app', 'USAGE') as app_usage
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'billing_replace_catalogue_service'`,
    )
    expect(row?.wrapper_body).toContain('app.billing_replace_catalogue')
    expect(row?.app_usage).toBe(true)
  })
})
