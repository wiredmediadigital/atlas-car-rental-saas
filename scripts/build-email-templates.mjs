#!/usr/bin/env node
/**
 * Regenerates supabase/templates/*.html from the TypeScript that defines them.
 *
 * The generator is the test — `supabase/tests/email-templates.test.ts` renders
 * every auth email and compares it with what is committed, so `npm run verify`
 * is what catches drift. Running it with UPDATE_EMAIL_TEMPLATES=1 makes it
 * write instead of compare.
 *
 * This wrapper exists only because `UPDATE_EMAIL_TEMPLATES=1 vitest ...` is
 * bash syntax: PowerShell and cmd parse it as a command name, so the documented
 * one-liner failed for anyone not in Git Bash. Setting the variable in Node and
 * spawning works in every shell, and is cheaper than adding cross-env to the
 * dependency tree for one line.
 */

import { spawn } from 'node:child_process'

const child = spawn('npx', ['vitest', 'run', 'supabase/tests/email-templates.test.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, UPDATE_EMAIL_TEMPLATES: '1' },
})

child.on('exit', (code) => process.exit(code ?? 1))
