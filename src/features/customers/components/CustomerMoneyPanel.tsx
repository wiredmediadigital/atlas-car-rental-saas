import { Plus, ReceiptText, Undo2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { rentalDetailPath } from '@/app/routes/paths'
import { Badge, Button, CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui'
import { PAYMENT_METHOD_LABELS } from '@/features/rentals/schemas'
import type { ComplianceOptions } from '@/lib/compliance/expiry'
import { formatDateTime } from '@/lib/datetime/format'
import { formatMoney } from '@/lib/money/money'
import { cn } from '@/lib/utils/cn'

import { CUSTOMER_PAYMENT_LIMIT } from '../api'
import {
  useCustomerAccountBalance,
  useCustomerFinancialSummary,
  useCustomerPayments,
  useCustomerRentals,
} from '../queries'
import { CustomerCreditDialog, type CreditIntent } from './CustomerCreditDialog'

export interface CustomerMoneyPanelProps {
  customerId: string
  compliance: ComplianceOptions
  locale: string
  /** The agency's own currency, for an account with nothing on it yet. */
  defaultCurrency: string
  canRecord: boolean
}

/**
 * What this customer owes, holds and has handed over.
 *
 * Money used to be visible one contract at a time: answering "what has this
 * person actually paid us" meant opening their bookings one by one and adding
 * up by eye. The position per currency sits above the entries that produced
 * it, so a figure somebody disputes can be traced to the receipts behind it
 * without leaving the page.
 *
 * The position lives here rather than beside the rental figures because it is
 * a table, and it was being asked to fit in a column too narrow to show it
 * without scrolling sideways.
 */
export function CustomerMoneyPanel({
  customerId,
  compliance,
  locale,
  defaultCurrency,
  canRecord,
}: CustomerMoneyPanelProps) {
  const financeQuery = useCustomerFinancialSummary(customerId)
  const paymentsQuery = useCustomerPayments(customerId)
  const balanceQuery = useCustomerAccountBalance(customerId)
  const rentals = useCustomerRentals(customerId).data ?? []

  const finance = financeQuery.data ?? []
  const payments = paymentsQuery.data ?? []
  const held = balanceQuery.data ?? []

  /*
   * One currency at a time, like every other figure here. The account is shown
   * in whichever currency it actually holds something in; an empty account
   * takes money in the agency's own.
   */
  const [credit, setCredit] = useState<{ intent: CreditIntent; currency: string } | null>(null)
  const heldIn = (currency: string) =>
    held.find((row) => row.currency === currency)?.on_account_minor ?? 0

  // Money taken against a booking that was called off, which is nobody's
  // charge. The column appears only when there is something in it: an agency
  // that has never cancelled anything should not read a column of zeroes.
  const hasRefunds = finance.some((row) => row.to_refund_minor > 0)
  const isCapped = payments.length === CUSTOMER_PAYMENT_LIMIT

  return (
    <>
      <CardHeader
        title="Money"
        description={
          hasRefunds
            ? 'A cancelled booking is not a charge. Money taken against one is shown as refundable.'
            : finance.length > 1
              ? 'Reported per currency — figures in different currencies are never added together.'
              : 'Across this customer’s contracts.'
        }
      />

      <CardBody className="p-0">
        {financeQuery.isPending ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : finance.length === 0 ? (
          <EmptyState
            size="sm"
            icon={ReceiptText}
            title="Nothing billed yet"
            description="Charges, payments and balances appear once this customer has a contract."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[0.8125rem]">
              <thead>
                <tr className="border-line border-b">
                  <th scope="col" className="eyebrow px-5 py-2 text-start font-semibold">
                    Currency
                  </th>
                  <th scope="col" className="eyebrow px-3 py-2 text-end font-semibold">
                    Charged
                  </th>
                  <th scope="col" className="eyebrow px-3 py-2 text-end font-semibold">
                    Paid
                  </th>
                  <th scope="col" className="eyebrow px-3 py-2 text-end font-semibold">
                    Outstanding
                  </th>
                  {hasRefunds ? (
                    <th scope="col" className="eyebrow px-3 py-2 text-end font-semibold">
                      To refund
                    </th>
                  ) : null}
                  <th scope="col" className="eyebrow px-5 py-2 text-end font-semibold">
                    Deposits held
                  </th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {finance.map((row) => (
                  <tr key={row.currency}>
                    <td className="identifier px-5 py-2.5">{row.currency}</td>
                    <td data-numeric="" className="px-3 py-2.5 text-end">
                      {formatMoney(row.charged_minor, row.currency, { locale })}
                    </td>
                    <td data-numeric="" className="px-3 py-2.5 text-end">
                      {formatMoney(row.paid_minor, row.currency, { locale })}
                    </td>
                    <td
                      data-numeric=""
                      className={cn(
                        'px-3 py-2.5 text-end',
                        row.outstanding_minor > 0 && 'text-critical-700 font-medium',
                      )}
                    >
                      {formatMoney(row.outstanding_minor, row.currency, { locale })}
                    </td>
                    {hasRefunds ? (
                      <td
                        data-numeric=""
                        className={cn(
                          'px-3 py-2.5 text-end',
                          row.to_refund_minor > 0 && 'text-critical-700 font-medium',
                        )}
                      >
                        {formatMoney(row.to_refund_minor, row.currency, { locale })}
                      </td>
                    ) : null}
                    <td data-numeric="" className="px-5 py-2.5 text-end">
                      {formatMoney(row.deposits_held_minor, row.currency, { locale })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>

      {canRecord ? (
        <div className="border-line flex flex-wrap items-center gap-x-4 gap-y-3 border-t px-5 py-4">
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-1.5">
              <Wallet className="size-3.5" aria-hidden="true" />
              Money on account
            </p>
            <p data-numeric="" className="text-ink mt-1 text-[0.8125rem] font-medium">
              {held.length === 0
                ? 'Nothing held'
                : held
                    .map((row) => formatMoney(row.on_account_minor, row.currency, { locale }))
                    .join(' · ')}
            </p>
            <p className="text-ink-subtle mt-0.5 text-[0.75rem]">
              Money that belongs to no booking yet.
            </p>
          </div>

          <div className="ms-auto flex flex-wrap items-center gap-2">
            {held.map((row) => (
              <Button
                key={`apply-${row.currency}`}
                variant="secondary"
                size="sm"
                onClick={() => setCredit({ intent: 'apply', currency: row.currency })}
              >
                Use {formatMoney(row.on_account_minor, row.currency, { locale })}
              </Button>
            ))}
            {held.map((row) => (
              <Button
                key={`payout-${row.currency}`}
                variant="ghost"
                size="sm"
                leadingIcon={<Undo2 />}
                onClick={() => setCredit({ intent: 'payout', currency: row.currency })}
              >
                Pay back
              </Button>
            ))}
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Plus />}
              onClick={() =>
                setCredit({
                  intent: 'take',
                  currency: held[0]?.currency ?? finance[0]?.currency ?? defaultCurrency,
                })
              }
            >
              Take on account
            </Button>
          </div>
        </div>
      ) : null}

      <CardHeader
        title="Payments and refunds"
        description={
          isCapped
            ? `The ${CUSTOMER_PAYMENT_LIMIT} most recent entries.`
            : 'Every entry on this customer, across all of their contracts.'
        }
        className="border-t"
      />

      <CardBody className="p-0">
        {paymentsQuery.isPending ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : payments.length === 0 ? (
          <EmptyState
            size="sm"
            icon={ReceiptText}
            title="Nothing recorded yet"
            description="Payments, deposits and refunds will be listed here as they are taken."
          />
        ) : (
          <ul className="divide-line divide-y">
            {payments.map((entry) => {
              const isVoided = entry.voided_at !== null
              const isOut = entry.direction === 'outbound'

              return (
                <li key={entry.id} className={cn('px-5 py-3', isVoided && 'opacity-60')}>
                  <p className="text-ink flex flex-wrap items-center gap-1.5 text-[0.8125rem]">
                    <span
                      data-numeric=""
                      className={cn(
                        'font-medium',
                        isVoided && 'line-through',
                        !isVoided && isOut && 'text-critical-700',
                      )}
                    >
                      {isOut ? '−' : ''}
                      {formatMoney(entry.amount_minor, entry.currency, { locale })}
                    </span>

                    {entry.purpose === 'deposit' ? (
                      <Badge tone="info">Deposit</Badge>
                    ) : (
                      <Badge tone="neutral">{isOut ? 'Refund' : 'Rental'}</Badge>
                    )}
                    {isVoided ? <Badge tone="critical">Voided</Badge> : null}

                    {/* Money with no booking is expressible in the schema and
                        nothing writes it yet; a ledger that could not show it
                        would stop adding up the day something does. */}
                    {entry.rental_id && entry.rental_reference ? (
                      <Link
                        to={rentalDetailPath(entry.rental_id)}
                        className="identifier hover:underline"
                      >
                        {entry.rental_reference}
                      </Link>
                    ) : (
                      <span className="text-ink-subtle">On account</span>
                    )}
                  </p>

                  <p className="text-ink-subtle mt-0.5 text-[0.75rem]">
                    {PAYMENT_METHOD_LABELS[entry.method]} ·{' '}
                    {formatDateTime(new Date(entry.paid_at), {
                      locale,
                      timeZone: compliance.timeZone,
                    })}
                    {entry.reference ? ` · ${entry.reference}` : ''}
                  </p>

                  {isVoided && entry.void_reason ? (
                    <p className="text-ink-subtle mt-0.5 text-[0.75rem] italic">
                      {entry.void_reason}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>

      {credit ? (
        <CustomerCreditDialog
          open
          onOpenChange={(open) => (open ? undefined : setCredit(null))}
          intent={credit.intent}
          customerId={customerId}
          currency={credit.currency}
          locale={locale}
          timeZone={compliance.timeZone}
          heldMinor={heldIn(credit.currency)}
          rentals={rentals}
        />
      ) : null}
    </>
  )
}
