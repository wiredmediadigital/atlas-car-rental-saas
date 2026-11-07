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
 * With no argument there is no origin to name, so robots.txt is written without
 * a Sitemap line and any sitemap.xml is removed. That is the honest state of an
 * unconfigured checkout: a robots.txt that points crawlers at a placeholder host
 * would be wrong and silent about it. Run it with your real domain, commit the
 * result, and rerun it after upgrading, because new help pages change the file.
 * robots.txt is written by the same run because its Sitemap line must be an
 * absolute URL and has to agree with the sitemap's origin.
 *
 * supabase/tests/help-sitemap.test.ts fails when the committed files have
 * drifted from the content folder.
 */

import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const CONTENT_DIR = join(ROOT, 'src', 'content', 'help')
export const SITEMAP_PATH = join(ROOT, 'public', 'sitemap.xml')
export const ROBOTS_PATH = join(ROOT, 'public', 'robots.txt')

/** Validates an origin argument and returns it without a trailing slash, or null when none was given. */
export function normaliseOrigin(value) {
  if (value === undefined || value === '') return null
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid origin "${value}": expected a URL such as https://rentals.example.com`)
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.hostname === '') {
    throw new Error(`Invalid origin "${value}": it must be an http or https URL with a host`)
  }
  // `url.origin` drops any path, so a site served from a subpath would silently
  // get a sitemap of URLs that 404 and a robots.txt pointing at the wrong host
  // root. Say so instead of guessing.
  if (url.pathname !== '/') {
    throw new Error(
      `Invalid origin "${value}": it must have no path. The Help Centre is served from the site root, so a sitemap for "${url.origin}" would not describe "${value}".`,
    )
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

/** Allows everything; names the sitemap only when the origin is known. */
export function buildRobots(origin) {
  const rules = 'User-agent: *\nAllow: /\n'
  return origin ? `${rules}\nSitemap: ${origin}/sitemap.xml\n` : rules
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const origin = normaliseOrigin(process.argv[2])
    writeFileSync(ROBOTS_PATH, buildRobots(origin))
    if (origin === null) {
      rmSync(SITEMAP_PATH, { force: true })
      console.log(
        `No origin given: wrote ${ROBOTS_PATH} without a Sitemap line and removed any sitemap.xml.`,
      )
      console.log('Run: npm run help:sitemap -- https://your-domain')
    } else {
      const slugs = listHelpSlugs()
      writeFileSync(SITEMAP_PATH, buildSitemap(origin, slugs))
      console.log(
        `Wrote ${slugs.length + 1} URLs for ${origin} to ${SITEMAP_PATH} and ${ROBOTS_PATH}`,
      )
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
