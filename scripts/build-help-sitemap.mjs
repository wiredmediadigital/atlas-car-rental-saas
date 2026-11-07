#!/usr/bin/env node
/**
 * Writes public/sitemap.xml and public/robots.txt for the Help Centre.
 *
 * One <url> for the help index and one per Markdown file in src/content/help,
 * so the sitemap follows the content folder and never needs editing by hand as
 * pages are added.
 *
 * The site origin is an argument because every self-hosted deployment lives on
 * its own domain:
 *
 *   npm run help:sitemap -- https://rentals.example.com
 *
 * With no argument it uses DEFAULT_ORIGIN, a placeholder. Run it with your real
 * domain before deploying; a sitemap that names another host is ignored by
 * crawlers. robots.txt is written by the same run because its Sitemap line must
 * be an absolute URL and has to agree with the sitemap's origin.
 *
 * supabase/tests/help-sitemap.test.ts fails when the committed files have
 * drifted from the content folder.
 */

import { readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const CONTENT_DIR = join(ROOT, 'src', 'content', 'help')
export const SITEMAP_PATH = join(ROOT, 'public', 'sitemap.xml')
export const ROBOTS_PATH = join(ROOT, 'public', 'robots.txt')
export const DEFAULT_ORIGIN = 'https://example.com'

/** Validates an origin argument and returns it without a trailing slash. */
export function normaliseOrigin(value) {
  if (value === undefined || value === '') return DEFAULT_ORIGIN
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid origin "${value}": expected a URL such as https://rentals.example.com`)
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.hostname === '') {
    throw new Error(`Invalid origin "${value}": it must be an http or https URL with a host`)
  }
  return url.origin
}

/** Slugs of every help article, sorted. */
export function listHelpSlugs(directory = CONTENT_DIR) {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.replace(/\.md$/, ''))
    .sort()
}

function escapeXml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function buildSitemap(origin, slugs) {
  const paths = ['/help', ...slugs.map((slug) => `/help/${slug}`)]
  const urls = paths.map((path) => `  <url><loc>${escapeXml(origin + path)}</loc></url>`)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}

export function buildRobots(origin) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const origin = normaliseOrigin(process.argv[2])
    const slugs = listHelpSlugs()
    writeFileSync(SITEMAP_PATH, buildSitemap(origin, slugs))
    writeFileSync(ROBOTS_PATH, buildRobots(origin))
    console.log(`Wrote ${slugs.length + 1} URLs for ${origin} to ${SITEMAP_PATH} and ${ROBOTS_PATH}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
