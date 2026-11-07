/**
 * Types for the help image manifest builder. Hand-written because `scripts/` is
 * plain ESM outside every tsconfig, and the header parser is worth testing.
 */

export interface ImageSize {
  width: number
  height: number
}

export declare const IMAGE_DIR: string
export declare const MANIFEST_PATH: string
export declare function readImageSize(buffer: Buffer): ImageSize
export declare function buildManifest(directory?: string): Record<string, ImageSize>
