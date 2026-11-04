import { AgreementWizard } from '@/features/financing/components/AgreementWizard'

/**
 * Recording a new financing agreement.
 *
 * The form itself lives in `AgreementWizard`, because editing a draft runs the
 * same four steps and a second copy would be a second place for the validation
 * and the schedule preview to drift apart.
 */
export function FinancingNewPage() {
  return <AgreementWizard />
}
