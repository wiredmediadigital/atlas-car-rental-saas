import { readFileSync } from 'node:fs'

import {
  buildManifest,
  MANIFEST_PATH,
  readImageSize,
} from '../../scripts/build-help-image-manifest.mjs'

/** A JPEG skeleton: SOI, an APP0 segment to step over, then a frame header. */
function jpegWith(width: number, height: number, marker = 0xc0): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00])
  const frame = Buffer.alloc(11)
  frame.set([0xff, marker, 0x00, 0x0b, 0x08])
  frame.writeUInt16BE(height, 5)
  frame.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame])
}

function pngWith(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

describe('help image manifest', () => {
  test('reads JPEG dimensions from the frame header, past other segments', () => {
    expect(readImageSize(jpegWith(640, 480))).toEqual({ width: 640, height: 480 })
    expect(readImageSize(jpegWith(321, 123, 0xc2))).toEqual({ width: 321, height: 123 })
  })

  test('reads PNG dimensions from the IHDR chunk', () => {
    expect(readImageSize(pngWith(900, 300))).toEqual({ width: 900, height: 300 })
  })

  test('rejects files that are neither JPEG nor PNG', () => {
    expect(() => readImageSize(Buffer.from('GIF89a......................'))).toThrow(/JPEG or PNG/)
  })

  test('the committed manifest matches the files in public/help', () => {
    const committed: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))

    expect(committed).toEqual(buildManifest())
  })
})
