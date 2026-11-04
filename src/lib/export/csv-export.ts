import { csvDate, csvNumber, csvText, guardCsvCell } from '@/features/reports/csv'
import { buildCsv } from '@/lib/import/csv'

/**
 * The parts every export of this product's own records shares.
 *
 * WHY THIS IS SEPARATE FROM THE REPORTS CSV HELPERS.
 *
 * Those are about CELLS — neutralising a formula, writing money without a
 * locale, writing a date the spreadsheet will not reinterpret. This is about
 * the FILE: what has to be true of it for somebody opening it a year later to
 * know what it is, and for the person who exported it to be able to trust it.
 * Four exports need both, and the cell rules were already shared. The file rules
 * were not, which is how the first one ended up being the only one that said
 * where it came from.
 *
 * WHAT A FILE HAS TO CARRY.
 *
 *   * WHO. The agency's name. A folder of exports from three agencies with no
 *     name in any of them is a folder of anonymous spreadsheets.
 *   * WHAT. The export's own title, because `export (3).csv` in a downloads
 *     folder is not self-describing.
 *   * WHICH ONES. The filters, in words. An export taken from a filtered screen
 *     and an export of everything look identical once opened, and the first
 *     reconciliation against the wrong one is expensive.
 *   * HOW MANY, and WHEN.
 *   * WHETHER IT IS COMPLETE. A truncated export that does not say so is worse
 *     than no export, because somebody reconciles against it and finds the
 *     totals short. The note is a row in the file, not a toast that is gone by
 *     the time the file is opened.
 *
 * THE FILENAME NAMES NOBODY. A downloads folder is shared, indexed and backed
 * up, so a file is named after what it holds and the date — never after a
 * customer, a plate or a registration. Same rule `reportFilename` follows.
 */

export interface ExportContext {
  readonly agencyName: string
  /** What the person was looking at, in words. Travels into the file. */
  readonly filterLabel: string
  readonly generatedAt: string
  /** True when the export stopped at the row ceiling rather than the last row. */
  readonly truncated?: boolean
}

export interface ExportFile {
  readonly filename: string
  readonly contents: string
}

/** The byte order mark. Without it Excel on Windows guesses the code page. */
const BOM = '﻿'

/** Mirrors the escaping `buildCsv` applies, for the provenance block. */
function escapeForCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * An ISO instant as a date-and-time a spreadsheet will not reinterpret.
 *
 * Trimmed to minutes and with the `T` replaced, so it reads `2026-11-04 14:05`.
 * Deliberately not localised: an export is a record, and a record that says
 * different things on two machines is not one.
 */
export function csvInstant(value: string | null | undefined): string {
  if (!value) return ''
  return guardCsvCell(value.slice(0, 16).replace('T', ' '))
}

/** `Yes`/`No` rather than `true`/`false`, which a spreadsheet may retype. */
export function csvBoolean(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  return value ? 'Yes' : 'No'
}

export function buildExportCsv(
  context: ExportContext,
  title: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const provenance: string[][] = [
    ['Agency', csvText(context.agencyName)],
    ['Export', csvText(title)],
    ['Showing', csvText(context.filterLabel)],
    ['Rows', csvNumber(rows.length)],
    ['Generated', csvText(context.generatedAt)],
  ]

  if (context.truncated) {
    provenance.push([
      'Note',
      csvText('This export reached its row limit. Narrow the filters and export again.'),
    ])
  }
  provenance.push([])

  const width = headers.length
  const head = provenance
    .map((line) => {
      const padded = [...line]
      while (padded.length < width) padded.push('')
      return padded.map(escapeForCsv).join(',')
    })
    .join('\n')

  /*
   * Body cells are guarded here as well as by the `csvText` the feature modules
   * already call. `guardCsvCell` is idempotent — an already-guarded value starts
   * with an apostrophe, which is not a formula lead — so the second pass costs
   * nothing and means a new export that forgets the helper on one column still
   * cannot put a live formula into somebody's spreadsheet. This is the last
   * place that can make that guarantee for every export at once.
   */
  const guarded = rows.map((row) => row.map(guardCsvCell))

  return `${BOM}${head}\n${buildCsv(headers.map(guardCsvCell), guarded)}`
}

export function exportFilename(prefix: string, generatedAt: string): string {
  return `${prefix}-${csvDate(generatedAt)}.csv`
}

/** Assembles the file and the name it should be saved under, together. */
export function buildExportFile(
  context: ExportContext,
  prefix: string,
  title: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): ExportFile {
  return {
    filename: exportFilename(prefix, context.generatedAt),
    contents: buildExportCsv(context, title, headers, rows),
  }
}

/* -------------------------------------------------------------------------- */
/* Collecting every page                                                      */
/* -------------------------------------------------------------------------- */

export interface ExportPage<TRow> {
  readonly rows: readonly TRow[]
  readonly total: number
  readonly pageCount: number
}

export interface CollectedRows<TRow> {
  readonly rows: TRow[]
  /** True when the ceiling was reached and there were more rows behind it. */
  readonly truncated: boolean
}

/**
 * How many rows an export will carry before it stops and says so.
 *
 * Not a licence limit and not a performance cliff — a browser assembling a
 * string holds the whole thing in memory, and an agency with four years of
 * records who asks for all of them should get a file that says it is partial
 * rather than a tab that stops responding.
 */
export const EXPORT_ROW_LIMIT = 10_000

/**
 * Every row matching a query, not just the page on screen.
 *
 * SAME QUERY, NO SECOND DEFINITION. It pages through the feature's own fetch
 * rather than rebuilding the filters, so an export cannot disagree with the
 * list it was started from — the failure that makes somebody distrust every
 * export they are given afterwards.
 *
 * Sequential rather than parallel on purpose. The pages have to arrive in order
 * for the file to be in the order the screen was, and firing a hundred requests
 * at once at a database the agency is already working in buys nothing.
 */
export async function collectForExport<TRow>(
  fetchPage: (page: number, pageSize: number) => Promise<ExportPage<TRow>>,
  limit: number = EXPORT_ROW_LIMIT,
): Promise<CollectedRows<TRow>> {
  const pageSize = 100
  const rows: TRow[] = []
  let page = 1

  for (;;) {
    const result = await fetchPage(page, pageSize)
    rows.push(...result.rows)

    if (rows.length >= limit) {
      return { rows: rows.slice(0, limit), truncated: result.total > limit }
    }
    if (page >= result.pageCount || result.rows.length === 0) {
      return { rows, truncated: false }
    }
    page += 1
  }
}
