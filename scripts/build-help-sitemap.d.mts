/**
 * Types for the help sitemap builder. Hand-written because `scripts/` is plain
 * ESM outside every tsconfig.
 */

export declare const CONTENT_DIR: string
export declare const SITEMAP_PATH: string
export declare const ROBOTS_PATH: string
export declare function normaliseOrigin(value: string | undefined): string | null
export declare function listHelpSlugs(directory?: string): string[]
export declare function buildSitemap(origin: string, slugs: readonly string[]): string
export declare function buildRobots(origin: string | null): string
