import { ArrowLeft } from 'lucide-react'
import { useParams } from 'react-router-dom'

import { financingDetailPath } from '@/app/routes/paths'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Alert, ButtonLink, Card, CardBody, PageHeader, Skeleton } from '@/components/ui'
import { AgreementWizard } from '@/features/financing/components/AgreementWizard'
import { useAgreement, useUpdateAgreement } from '@/features/financing/queries'
import { agreementToForm } from '@/features/financing/schemas'

/**
 * Correcting a draft agreement.
 *
 * The detail page tells an agency, in words, that a draft's terms "can be
 * corrected freely until it is activated". For a long time nothing honoured
 * that: `updateAgreement` and `useUpdateAgreement` existed, no screen called
 * them, and the only ways out of a wrong draft were to activate it anyway or
 * delete it and retype. This page is the missing half.
 *
 * WHY DRAFTS ONLY, AND WHY THE CHECK IS HERE.
 *
 * Activation writes the payment schedule in the same transaction that flips the
 * status, so an activated agreement has obligations hanging off its terms.
 * Editing those terms underneath an existing schedule would leave the two
 * disagreeing, and the schedule is what the agency chases people for.
 *
 * `termsFrozenReason` is the related rule but it is not this one: it allows an
 * activated agreement with no payments yet recorded, which would still have a
 * schedule. This check is deliberately narrower — draft or nothing — and it
 * lives on the page rather than only on the button because a route is reachable
 * by typing it.
 */
export function FinancingEditPage() {
  const { financingId } = useParams<{ financingId: string }>()
  const agreementQuery = useAgreement(financingId)
  const update = useUpdateAgreement(financingId ?? '')

  if (agreementQuery.isError) {
    return (
      <Card>
        <ErrorState
          title="This agreement could not be found"
          error={agreementQuery.error}
          onRetry={() => void agreementQuery.refetch()}
        />
      </Card>
    )
  }

  const agreement = agreementQuery.data

  if (!agreement || !financingId) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Card>
          <CardBody className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardBody>
        </Card>
      </div>
    )
  }

  if (agreement.agreement_status !== 'draft') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Edit financing"
          eyebrow="Finance"
          actions={
            <ButtonLink
              variant="ghost"
              leadingIcon={<ArrowLeft />}
              to={financingDetailPath(financingId)}
            >
              Back to the agreement
            </ButtonLink>
          }
        />
        <Alert tone="info" title="These terms are no longer a draft">
          This agreement has been activated, so its payment schedule exists and the terms it was
          built from are fixed. If the contract itself changed, close this agreement and record the
          replacement.
        </Alert>
      </div>
    )
  }

  return (
    <AgreementWizard
      editing={{
        agreementId: financingId,
        initialValues: agreementToForm(agreement),
        save: update.mutateAsync,
        isSaving: update.isPending,
      }}
    />
  )
}
