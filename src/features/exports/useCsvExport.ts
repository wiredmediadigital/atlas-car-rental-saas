import { useCallback, useState } from 'react'

import { useToast } from '@/components/ui/toast/toast-context'
import { downloadCsv } from '@/features/reports/csv'
import { useOrganization } from '@/features/workspace/workspace-context'
import type { CollectedRows, ExportContext, ExportFile } from '@/lib/export/csv-export'
import { toAppError } from '@/lib/supabase/errors'

/**
 * Turning a filtered list into a file the person can keep.
 *
 * WHY A HOOK RATHER THAN FOUR HANDLERS.
 *
 * The four exports differ in exactly two ways: which fetch they page through
 * and which builder shapes the columns. Everything else — the busy flag, the
 * empty case, the truncation warning, the error toast, the agency name and the
 * generated timestamp — was identical, and four copies of it is four places for
 * the truncation warning to be forgotten in three of them.
 *
 * WHY THE EMPTY CASE IS A TOAST AND NOT A FILE. Downloading a spreadsheet with
 * a header row and nothing under it looks like a broken export, and the person
 * then cannot tell whether the filters matched nothing or the export failed.
 * Saying so is both shorter and truer.
 *
 * WHY THE TRUNCATION TOAST NEVER DISMISSES ITSELF (`duration: 0`). It is the
 * one message that changes what the file means. A note is written into the file
 * as well — the toast is gone by the time anybody opens it — but somebody who
 * exported 10,000 of 14,000 rows needs to know before they start working with
 * it, not after.
 */
export interface CsvExportOptions<TRow> {
  /** Pages through the feature's own list query. */
  readonly fetchRows: () => Promise<CollectedRows<TRow>>
  /** Shapes the columns for this entity. */
  readonly build: (context: ExportContext, rows: readonly TRow[]) => ExportFile
  /** What the person was looking at, in words. Travels into the file. */
  readonly filterLabel: string
  /** Plural noun for the empty case: "No customers match the current filters." */
  readonly noun: string
}

export interface CsvExport {
  readonly exportNow: () => Promise<void>
  readonly isExporting: boolean
}

export function useCsvExport<TRow>(options: CsvExportOptions<TRow>): CsvExport {
  const organization = useOrganization()
  const toast = useToast()
  const [isExporting, setIsExporting] = useState(false)

  const { fetchRows, build, filterLabel, noun } = options

  const exportNow = useCallback(async () => {
    setIsExporting(true)
    try {
      const result = await fetchRows()

      if (result.rows.length === 0) {
        toast.toast({
          title: 'Nothing to export',
          description: `No ${noun} match the current filters.`,
          tone: 'info',
        })
        return
      }

      const file = build(
        {
          agencyName: organization.name,
          filterLabel,
          generatedAt: new Date().toISOString(),
          truncated: result.truncated,
        },
        result.rows,
      )
      downloadCsv(file.filename, file.contents)

      if (result.truncated) {
        toast.toast({
          title: 'Export reached its limit',
          description: `The file holds the first 10,000 ${noun}. Narrow the filters for the rest.`,
          tone: 'caution',
          duration: 0,
        })
      }
    } catch (error) {
      toast.error('The export could not be completed', toAppError(error).message)
    } finally {
      setIsExporting(false)
    }
  }, [fetchRows, build, filterLabel, noun, organization.name, toast])

  return { exportNow, isExporting }
}
