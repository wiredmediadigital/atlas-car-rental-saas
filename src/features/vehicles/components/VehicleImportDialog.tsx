import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { Alert, Badge, Button, Dialog, DialogContent, Select, useToast } from '@/components/ui'
import { useOrganization } from '@/features/workspace/workspace-context'
import { toAppError } from '@/lib/supabase/errors'
import { cn } from '@/lib/utils/cn'

import { importVehicles } from '../api'
import {
  IMPORT_FIELDS,
  type ColumnMapping,
  type VehicleImportRow,
  type ParsedCsv,
  buildImportTemplate,
  guessColumnMapping,
  isImportable,
  parseCsv,
  validateImportRows,
} from '../csv'
import { plateComparisonKey } from '../normalise'
import { useVehicleList, vehicleKeys } from '../queries'

type Step = 'choose' | 'map' | 'result'

export interface VehicleImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ImportOutcome {
  imported: number
}

const MAX_ROWS = 500

/**
 * Bulk vehicle import from a CSV export.
 *
 * The file never reaches the server unvalidated: it is parsed in the browser,
 * mapped to our fields, and put through the same schema the Add vehicle form
 * uses. Rows that would not pass that form do not import, and the preview says
 * which and why before anything is written.
 *
 * The import is all or nothing. Rows that fail validation here are left out and
 * named in the preview, but once the file goes to the server it is one
 * transaction: a half-loaded fleet is worse than a refusal that says why.
 */
export function VehicleImportDialog(props: VehicleImportDialogProps) {
  // Mounted only while open, so the existing-plate lookup below does not run on
  // every visit to the fleet page for a dialog nobody opened.
  if (!props.open) return null
  return <ImportDialogContent {...props} />
}

function ImportDialogContent({ open, onOpenChange }: VehicleImportDialogProps) {
  const organization = useOrganization()
  const client = useQueryClient()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('choose')
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)

  // Existing plates, so the preview can flag collisions before the database does.
  const existingQuery = useVehicleList({ pageSize: 100, includeArchived: true })
  const existingPlateKeys = useMemo(
    () =>
      new Set(
        (existingQuery.data?.rows ?? []).map((row) => plateComparisonKey(row.registration_plate)),
      ),
    [existingQuery.data],
  )

  const validation = useMemo(() => {
    if (!parsed) return null
    return validateImportRows(parsed, mapping, {
      currency: organization.default_currency,
      existingPlateKeys,
    })
  }, [parsed, mapping, organization.default_currency, existingPlateKeys])

  const reset = () => {
    setStep('choose')
    setParsed(null)
    setMapping({})
    setFileName('')
    setError(null)
    setOutcome(null)
  }

  const handleClose = (next: boolean) => {
    onOpenChange(next)
    if (!next) setTimeout(reset, 200)
  }

  const handleFile = async (file: File) => {
    setError(null)

    if (file.size > 5 * 1024 * 1024) {
      setError(
        'That file is larger than 5 MB. Split it into smaller files and import each in turn.',
      )
      return
    }

    const text = await file.text()
    const result = parseCsv(text)

    if (result.headers.length === 0 || result.rows.length === 0) {
      setError('That file has no data rows. Check it was exported as CSV.')
      return
    }
    if (result.rows.length > MAX_ROWS) {
      setError(
        `That file has ${result.rows.length} rows. Import up to ${MAX_ROWS} at a time so a failure part-way through stays easy to unpick.`,
      )
      return
    }

    setFileName(file.name)
    setParsed(result)
    setMapping(guessColumnMapping(result.headers))
    setStep('map')
  }

  const runImport = useMutation({
    // One call, one transaction: every row lands or none does, so there is no
    // per-row progress to report and no half-loaded fleet to explain.
    mutationFn: async (rows: VehicleImportRow[]): Promise<ImportOutcome> => {
      const values = rows.flatMap((row) => (row.values ? [row.values] : []))
      if (values.length === 0) return { imported: 0 }

      const created = await importVehicles(organization.id, values)
      return { imported: created.length }
    },
    onSuccess: async (result) => {
      setOutcome(result)
      setStep('result')
      // The same subtree the Add vehicle form invalidates: list, counts and makes.
      await client.invalidateQueries({ queryKey: vehicleKeys.all(organization.id) })
      if (result.imported > 0) {
        toast.success(
          `${result.imported} ${result.imported === 1 ? 'vehicle' : 'vehicles'} imported`,
        )
      }
    },
    onError: (cause: unknown) => {
      const { kind, message } = toAppError(cause)
      // A refusal from the database rolled the whole batch back. A network or
      // unknown failure might not have, so it does not claim that.
      const refused = kind === 'conflict' || kind === 'validation' || kind === 'permission'
      setError(
        refused && !/nothing was imported/i.test(message)
          ? `${message} Nothing was imported.`
          : message,
      )
    },
  })

  const downloadTemplate = () => {
    const blob = new Blob([buildImportTemplate()], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'fleet-import-template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const importable = validation?.rows.filter(isImportable) ?? []

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        title="Import vehicles"
        description="Bring an existing fleet in from a spreadsheet."
        size={step === 'map' ? 'xl' : 'lg'}
        footer={
          step === 'map' ? (
            <>
              <p className="text-ink-subtle me-auto text-[0.75rem]">
                {validation?.validCount ?? 0} ready · {validation?.errorCount ?? 0} with errors ·{' '}
                {validation?.duplicateCount ?? 0} duplicates
              </p>
              <Button variant="ghost" onClick={() => setStep('choose')}>
                Choose another file
              </Button>
              <Button
                variant="primary"
                isLoading={runImport.isPending}
                disabled={importable.length === 0}
                onClick={() => runImport.mutate(importable)}
              >
                Import {importable.length} {importable.length === 1 ? 'vehicle' : 'vehicles'}
              </Button>
            </>
          ) : step === 'result' ? (
            <Button variant="primary" onClick={() => handleClose(false)}>
              Done
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => handleClose(false)}>
              Cancel
            </Button>
          )
        }
      >
        {error ? (
          <Alert tone="critical" className="mb-4">
            {error}
          </Alert>
        ) : null}

        {step === 'choose' ? (
          <div className="space-y-4">
            <div className="border-line-strong rounded-lg border border-dashed p-8 text-center">
              <FileSpreadsheet className="text-ink-subtle mx-auto size-8" aria-hidden="true" />
              <p className="text-ink mt-3 text-[0.875rem] font-medium">Choose a CSV file</p>
              <p className="text-ink-muted mx-auto mt-1 max-w-sm text-[0.8125rem] leading-5">
                Column names do not have to match ours — you will be able to line them up in the
                next step.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleFile(file)
                  event.target.value = ''
                }}
              />

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="primary"
                  leadingIcon={<Upload />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Select file
                </Button>
                <Button variant="secondary" leadingIcon={<Download />} onClick={downloadTemplate}>
                  Download template
                </Button>
              </div>
            </div>

            <p className="text-ink-subtle text-[0.75rem] leading-5">
              Make, model and registration plate are required. Everything else is optional. Rented
              and reserved cannot be imported — a vehicle's occupancy comes from its contracts.
            </p>
          </div>
        ) : null}

        {step === 'map' && parsed && validation ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{fileName}</Badge>
              <span className="text-ink-subtle text-[0.75rem]">
                {parsed.rows.length} {parsed.rows.length === 1 ? 'row' : 'rows'}
              </span>
            </div>

            <section>
              <p className="eyebrow mb-2">Match your columns</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {IMPORT_FIELDS.map((field) => (
                  <label key={field.key} className="space-y-1.5">
                    <span className="text-ink block text-[0.8125rem] font-medium">
                      {field.label}
                      {field.required ? (
                        <span className="text-critical-600 ms-0.5" aria-hidden="true">
                          *
                        </span>
                      ) : null}
                    </span>
                    <Select
                      value={mapping[field.key] == null ? '' : String(mapping[field.key])}
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          [field.key]:
                            event.target.value === '' ? null : Number(event.target.value),
                        }))
                      }
                      options={[
                        { value: '', label: 'Not imported' },
                        ...parsed.headers.map((header, index) => ({
                          value: String(index),
                          label: header || `Column ${index + 1}`,
                        })),
                      ]}
                    />
                  </label>
                ))}
              </div>
            </section>

            <section>
              <p className="eyebrow mb-2">Preview</p>
              <div className="border-line max-h-72 overflow-auto rounded-lg border">
                <table className="w-full border-collapse text-[0.75rem]">
                  <thead className="bg-surface-muted sticky top-0">
                    <tr className="border-line border-b">
                      <th scope="col" className="eyebrow w-12 px-3 py-2 text-start">
                        Row
                      </th>
                      <th scope="col" className="eyebrow px-3 py-2 text-start">
                        Vehicle
                      </th>
                      <th scope="col" className="eyebrow px-3 py-2 text-start">
                        Plate
                      </th>
                      <th scope="col" className="eyebrow px-3 py-2 text-start">
                        Result
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-line divide-y">
                    {validation.rows.map((row) => {
                      const ok = isImportable(row)
                      const reason =
                        row.issues[0]?.message ??
                        (row.duplicateOfLine !== null
                          ? `Same plate as row ${row.duplicateOfLine}`
                          : row.conflictsWithExisting
                            ? 'A vehicle with this plate is already in the fleet'
                            : null)

                      return (
                        <tr key={row.line} className={cn(!ok && 'bg-critical-50/40')}>
                          <td data-numeric="" className="text-ink-subtle px-3 py-1.5">
                            {row.line}
                          </td>
                          <td className="text-ink px-3 py-1.5">
                            {row.values ? `${row.values.make} ${row.values.model}` : '—'}
                          </td>
                          <td className="identifier px-3 py-1.5">{row.identifier || '—'}</td>
                          <td className="px-3 py-1.5">
                            {ok ? (
                              <span className="text-positive-700 inline-flex items-center gap-1">
                                <CheckCircle2 className="size-3" aria-hidden="true" />
                                Ready
                              </span>
                            ) : (
                              <span className="text-critical-700 inline-flex items-center gap-1">
                                <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
                                {reason}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}

        {step === 'result' && outcome ? (
          <Alert
            tone="positive"
            title={`${outcome.imported} ${outcome.imported === 1 ? 'vehicle' : 'vehicles'} imported`}
          >
            They are in your fleet now and ready to put on contracts.
          </Alert>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
