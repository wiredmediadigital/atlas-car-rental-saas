import { useRef, useState } from 'react'
import { Download, Paperclip, Trash2 } from 'lucide-react'

import { Button, Card, CardBody, CardHeader, EmptyState, useToast } from '@/components/ui'
import { maintenanceDocumentUrl, type MaintenanceDocument } from '@/features/maintenance/api'
import {
  useDeleteMaintenanceDocument,
  useMaintenanceDocuments,
  useUploadMaintenanceDocument,
} from '@/features/maintenance/queries'
import { formatDate } from '@/lib/datetime/format'
import { toErrorMessage } from '@/lib/supabase/errors'

const ACCEPTED = 'application/pdf,image/png,image/jpeg,image/webp'
const MAX_BYTES = 10 * 1024 * 1024

/**
 * Service invoices, estimates, reports and photographs for one record.
 *
 * The bucket is private. Nothing here produces a shareable link: a file is
 * opened through a signed URL that expires in a minute, so a link copied out of
 * the address bar stops working rather than becoming a way in.
 */
export interface MaintenanceDocumentsProps {
  maintenanceId: string
  canUpload: boolean
  canDelete: boolean
  locale: string
  timeZone: string
}

export function MaintenanceDocuments({
  maintenanceId,
  canUpload,
  canDelete,
  locale,
  timeZone,
}: MaintenanceDocumentsProps) {
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const documents = useMaintenanceDocuments(maintenanceId)
  const upload = useUploadMaintenanceDocument(maintenanceId)
  const remove = useDeleteMaintenanceDocument(maintenanceId)

  async function choose(file: File | undefined) {
    if (!file) return
    setError(null)
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 10 MB.')
      return
    }
    try {
      await upload.mutateAsync(file)
      toast.success('Document added')
    } catch (cause) {
      setError(toErrorMessage(cause))
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function open(document: MaintenanceDocument) {
    setError(null)
    try {
      const url = await maintenanceDocumentUrl(document.storage_path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (cause) {
      setError(toErrorMessage(cause))
    }
  }

  async function discard(document: MaintenanceDocument) {
    setError(null)
    try {
      await remove.mutateAsync(document)
      toast.success('Document removed')
    } catch (cause) {
      setError(toErrorMessage(cause))
    }
  }

  const rows = documents.data ?? []

  return (
    <Card>
      <CardHeader
        title="Supporting documents"
        description="Invoices, estimates, reports and photographs. Stored privately."
        actions={
          canUpload ? (
            <>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED}
                className="hidden"
                onChange={(event) => void choose(event.target.files?.[0])}
              />
              <Button
                variant="secondary"
                leadingIcon={<Paperclip />}
                isLoading={upload.isPending}
                onClick={() => inputRef.current?.click()}
              >
                Add document
              </Button>
            </>
          ) : null
        }
      />
      <CardBody>
        {error ? (
          <p role="alert" className="text-danger mb-3 text-sm">
            {error}
          </p>
        ) : null}

        {documents.isLoading ? (
          <p className="text-ink-subtle text-sm">Loading documents…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Attach the invoice or report once the work is done."
          />
        ) : (
          <ul className="divide-line divide-y">
            {rows.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{document.file_name}</p>
                  <p className="text-ink-subtle text-[0.8125rem]">
                    {formatDate(new Date(document.created_at), { locale, timeZone })}
                    {` · ${Math.max(1, Math.round(document.byte_size / 1024))} KB`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    leadingIcon={<Download />}
                    onClick={() => void open(document)}
                  >
                    Open
                  </Button>
                  {canDelete ? (
                    <Button
                      variant="ghost"
                      leadingIcon={<Trash2 />}
                      isLoading={remove.isPending}
                      onClick={() => void discard(document)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
