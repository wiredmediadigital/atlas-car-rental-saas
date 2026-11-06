export const HELP_GROUPS = [
  'Getting started',
  'Overview',
  'Operations',
  'Fleet',
  'Finance',
  'Agency',
  'Reference',
] as const

export type HelpGroup = (typeof HELP_GROUPS)[number]

export interface HelpFrontMatter {
  title: string
  group: HelpGroup
  /** Optional: some pages have no matching permission key. */
  permission?: string
  summary: string
}

export interface HelpPage {
  slug: string
  frontMatter: HelpFrontMatter
  body: string
}
