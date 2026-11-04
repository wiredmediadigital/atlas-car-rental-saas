import { describe, expect, it, vi } from 'vitest'

import {
  buildExportCsv,
  buildExportFile,
  collectForExport,
  csvBoolean,
  csvInstant,
  EXPORT_ROW_LIMIT,
  exportFilename,
  type ExportContext,
} from './csv-export'

const context: ExportContext = {
  agencyName: 'Atlas Cars',
  filterLabel: 'Everything',
  generatedAt: '2026-11-04T12:00:00.000Z',
}

const HEADERS = ['Name', 'Amount'] as const

describe('what every export file has to carry', () => {
  it('says who produced it, what it is, and which rows', () => {
    const csv = buildExportCsv(context, 'Customers', HEADERS, [['Yasmine', '10.00']])

    expect(csv).toContain('Agency,Atlas Cars')
    expect(csv).toContain('Export,Customers')
    expect(csv).toContain('Showing,Everything')
    expect(csv).toContain('Rows,1')
    expect(csv).toContain('Generated,2026-11-04T12:00:00.000Z')
  })

  it('opens with a byte order mark so Excel does not guess the code page', () => {
    // Without it, "Citroën" arrives as mojibake on a Windows machine.
    const csv = buildExportCsv(context, 'Fleet', HEADERS, [['Citroën C3', '1.00']])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('Citroën')
  })

  it('says so in the file when it stopped at the row limit', () => {
    // A truncated export that does not say so is worse than no export: somebody
    // reconciles against it and finds the totals short.
    const csv = buildExportCsv({ ...context, truncated: true }, 'Fleet', HEADERS, [['a', '1']])
    expect(csv).toContain('row limit')
  })

  it('says nothing about a limit it did not reach', () => {
    expect(buildExportCsv(context, 'Fleet', HEADERS, [['a', '1']])).not.toContain('row limit')
  })

  it('pads the provenance block to the width of the table', () => {
    // A short row in a CSV is a ragged file, and some parsers reject it.
    const csv = buildExportCsv(context, 'Fleet', ['A', 'B', 'C', 'D'], [['1', '2', '3', '4']])
    // The byte order mark lives on the first line, which is this one.
    const agencyLine = csv.replace('﻿', '').split('\n')[0]
    expect(agencyLine).toBe('Agency,Atlas Cars,,')
  })

  it('names nobody in the filename', () => {
    // A downloads folder is shared, indexed and backed up.
    const name = exportFilename('customers', context.generatedAt)
    expect(name).toBe('customers-2026-11-04.csv')
  })

  it('produces a file and a name together', () => {
    const file = buildExportFile(context, 'vehicles', 'Fleet', HEADERS, [['Peugeot', '2.00']])
    expect(file.filename).toBe('vehicles-2026-11-04.csv')
    expect(file.contents).toContain('Peugeot')
  })

  it('defuses a cell a spreadsheet would run as a formula', () => {
    const csv = buildExportCsv(context, 'Customers', HEADERS, [
      ['=HYPERLINK("http://evil.example","Click")', '1'],
    ])
    expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m)
  })
})

describe('the cell helpers this module adds', () => {
  it('writes an instant a spreadsheet will not reinterpret', () => {
    expect(csvInstant('2026-11-04T14:05:33.000Z')).toBe('2026-11-04 14:05')
  })

  it('leaves an absent instant empty rather than writing null', () => {
    expect(csvInstant(null)).toBe('')
    expect(csvInstant(undefined)).toBe('')
  })

  it('writes Yes and No, which a spreadsheet will not retype', () => {
    expect(csvBoolean(true)).toBe('Yes')
    expect(csvBoolean(false)).toBe('No')
    expect(csvBoolean(null)).toBe('')
  })
})

describe('collecting every page', () => {
  function pager(total: number) {
    return vi.fn((page: number, pageSize: number) => {
      const start = (page - 1) * pageSize
      const rows = Array.from(
        { length: Math.max(0, Math.min(pageSize, total - start)) },
        (_, index) => start + index,
      )
      return Promise.resolve({
        rows,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      })
    })
  }

  it('returns everything when it fits, in page order', async () => {
    const fetchPage = pager(250)
    const result = await collectForExport(fetchPage)

    expect(result.rows).toHaveLength(250)
    expect(result.truncated).toBe(false)
    // Order matters: the file has to be in the order the screen was.
    expect(result.rows[0]).toBe(0)
    expect(result.rows[249]).toBe(249)
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })

  it('stops at the ceiling and admits there was more', async () => {
    const result = await collectForExport(pager(12_000), 300)
    expect(result.rows).toHaveLength(300)
    expect(result.truncated).toBe(true)
  })

  it('does not claim truncation when it stopped exactly at the last row', async () => {
    // total === limit is complete, not truncated. Off by one here would put a
    // warning on a file that holds everything.
    const result = await collectForExport(pager(300), 300)
    expect(result.rows).toHaveLength(300)
    expect(result.truncated).toBe(false)
  })

  it('handles a query that matches nothing without looping', async () => {
    const fetchPage = pager(0)
    const result = await collectForExport(fetchPage)

    expect(result.rows).toEqual([])
    expect(result.truncated).toBe(false)
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('defaults to a ceiling the interface quotes back to people', () => {
    // The toast says "the first 10,000". If these two disagree, the message is
    // a lie nobody reports and everybody notices.
    expect(EXPORT_ROW_LIMIT).toBe(10_000)
  })
})
