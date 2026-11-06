import { HELP_GROUPS, type HelpFrontMatter, type HelpGroup } from './types'

const DELIMITER = '---'
const BOM = String.fromCharCode(0xfeff)
const REQUIRED_KEYS = ['title', 'group', 'summary'] as const

function isHelpGroup(value: string): value is HelpGroup {
  return (HELP_GROUPS as readonly string[]).includes(value)
}

export function parseFrontMatter(
  raw: string,
  fileName: string,
): { frontMatter: HelpFrontMatter; body: string } {
  const text = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw
  const lines = text.split(/\r?\n/)
  if (lines[0] !== DELIMITER) {
    throw new Error(`${fileName}: missing front matter block`)
  }
  const end = lines.indexOf(DELIMITER, 1)
  if (end === -1) {
    throw new Error(`${fileName}: front matter block is not closed`)
  }

  const values = new Map<string, string>()
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') continue
    const colon = line.indexOf(':')
    if (colon === -1) {
      throw new Error(`${fileName}: invalid front matter line "${line}"`)
    }
    values.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }

  for (const key of REQUIRED_KEYS) {
    if (!values.get(key)) {
      throw new Error(`${fileName}: front matter is missing required key "${key}"`)
    }
  }
  const title = values.get('title') as string
  const group = values.get('group') as string
  const summary = values.get('summary') as string
  if (!isHelpGroup(group)) {
    throw new Error(
      `${fileName}: front matter key "group" is "${group}", expected one of ${HELP_GROUPS.join(', ')}`,
    )
  }
  const permission = values.get('permission')

  return {
    frontMatter: { title, group, summary, ...(permission ? { permission } : {}) },
    body: lines.slice(end + 1).join('\n'),
  }
}
