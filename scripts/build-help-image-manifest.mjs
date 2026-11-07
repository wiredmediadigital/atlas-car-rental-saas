#!/usr/bin/env node
/**
 * Writes src/features/help/image-manifest.json: the intrinsic width and height
 * of every image in public/help, read from the file headers.
 *
 * `HelpImage` puts those numbers on the <img> so the browser reserves the right
 * box before the file arrives and the page does not jump. They are read from
 * each file rather than assumed: every capture to date happens to be 1568x726,
 * but a cropped shot will not be, and a wrong size is worse than none.
 *
 * Only JPEG and PNG are understood — the two formats the shot list allows. Any
 * other file in the folder fails the run instead of being skipped, because a
 * skipped image renders as a gap in a published article.
 *
 * Run with `npm run help:images` after adding or replacing an image. The
 * manifest is committed; supabase/tests/help-image-manifest.test.ts fails when
 * it has drifted from the folder.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const IMAGE_DIR = join(ROOT, 'public', 'help')
export const MANIFEST_PATH = join(ROOT, 'src', 'features', 'help', 'image-manifest.json')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_IHDR_OFFSET = 12
const PNG_WIDTH_OFFSET = 16

/** Start-of-frame markers carry the dimensions; C4, C8 and CC share the range but do not. */
function isStartOfFrame(marker) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

function readPngSize(buffer) {
  if (
    buffer.length < PNG_WIDTH_OFFSET + 8 ||
    buffer.toString('ascii', PNG_IHDR_OFFSET, 16) !== 'IHDR'
  ) {
    throw new Error('truncated PNG header')
  }
  return {
    width: buffer.readUInt32BE(PNG_WIDTH_OFFSET),
    height: buffer.readUInt32BE(PNG_WIDTH_OFFSET + 4),
  }
}

function readJpegSize(buffer) {
  let offset = 2
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error('malformed JPEG: expected a marker')
    const marker = buffer[offset + 1]
    if (marker === 0xff) {
      offset += 1
      continue
    }
    const length = buffer.readUInt16BE(offset + 2)
    if (isStartOfFrame(marker)) {
      if (offset + 9 > buffer.length) break
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
    }
    offset += 2 + length
  }
  throw new Error('JPEG has no frame header')
}

/** Reads { width, height } from a JPEG or PNG buffer. Throws on anything else. */
export function readImageSize(buffer) {
  let size
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) size = readPngSize(buffer)
  else if (buffer[0] === 0xff && buffer[1] === 0xd8) size = readJpegSize(buffer)
  else throw new Error('not a JPEG or PNG file')

  if (size.width < 1 || size.height < 1) throw new Error('image has no area')
  return size
}

/** Builds the manifest for a folder, keyed by file name and sorted for stable diffs. */
export function buildManifest(directory = IMAGE_DIR) {
  const entries = readdirSync(directory)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .map((name) => {
      try {
        return [name, readImageSize(readFileSync(join(directory, name)))]
      } catch (error) {
        throw new Error(`${name}: ${error.message}`, { cause: error })
      }
    })
  return Object.fromEntries(entries)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const manifest = buildManifest()
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${Object.keys(manifest).length} entries to ${MANIFEST_PATH}`)
}
