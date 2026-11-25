// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { TestDatabase } from './support/harness'

describe('incident management contract', () => {
  it('creates tenant-scoped tables with private storage and guarded RPCs', async () => {
    const db = await TestDatabase.create()
    try {
      const [tables] = await db.sql<{ incidents_rls: boolean; attachments_rls: boolean }>(`
        select
          (select relrowsecurity from pg_class where oid = 'public.incidents'::regclass) as incidents_rls,
          (select relrowsecurity from pg_class where oid = 'public.incident_attachments'::regclass) as attachments_rls
      `)
      expect(tables).toEqual({ incidents_rls: true, attachments_rls: true })

      const [functions] = await db.sql<{ create_security: string; resolve_security: string }>(`
        select
          (select prosrc from pg_proc where oid = 'public.incident_create(uuid,uuid,uuid,public.incident_type,timestamptz,text,text,public.incident_responsibility,text,text,text,text)'::regprocedure) like '%app.has_min_role%' as create_security,
          (select prosrc from pg_proc where oid = 'public.incident_resolve(uuid,text)'::regprocedure) like '%app.has_min_role%' as resolve_security
      `)
      expect(functions).toEqual({ create_security: true, resolve_security: true })

      const [buckets] = await db.sql<{ photo_private: boolean; document_private: boolean }>(`
        select
          (select not public from storage.buckets where id = 'incident-photos') as photo_private,
          (select not public from storage.buckets where id = 'incident-documents') as document_private
      `)
      expect(buckets).toEqual({ photo_private: true, document_private: true })
    } finally {
      await db.close()
    }
  })
})
