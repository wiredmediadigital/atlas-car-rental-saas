import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import {
  fetchBookingPage,
  type BookingPageResult,
  type PublicVehicle,
} from '@/features/booking/api'
import { RequestForm } from '@/features/booking/components/RequestForm'
import { VehicleCard } from '@/features/booking/components/VehicleCard'
import { formatWindow } from '@/features/booking/dates'
import { Spinner } from '@/components/ui'

/**
 * An agency's public booking page.
 *
 * OUTSIDE EVERY GUARD. No session, no workspace, no second factor — a visitor
 * who has never heard of Pevvy lands here from the agency's own website. The
 * route is registered beside `/terms` and `/privacy`, above `RequireAuth`,
 * because anything inside it would send this visitor to a sign-in screen.
 *
 * It reads one endpoint and renders what it is given. There is no Supabase
 * client on this page and no key in it: the browser has no grant on anything in
 * this feature, and the Edge Function is the whole of what the public can
 * reach.
 *
 * WHAT THE PAGE DOES NOT SAY. There is no "4 of 9 available", no count of the
 * fleet and no count of what is taken. How busy an agency is on a given weekend
 * is commercially theirs, and a competitor refreshing this page would otherwise
 * have a utilisation report for free. An unavailable car is dimmed and says
 * `not free for these dates` — one sentence for every reason, because a renter
 * has no business knowing which car is in the workshop.
 */
export function BookingPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  /*
   * The answer carries the slug it answers for, rather than being cleared
   * synchronously when the slug changes. Clearing inside the effect is a
   * setState during render in all but name -- React warns about exactly that --
   * and it is not needed: an answer for a previous slug is simply not this
   * slug's answer, which is what `loaded` below checks.
   */
  const [answered, setAnswered] = useState<{ slug: string; result: BookingPageResult } | null>(null)
  /** The car being asked about, or null while the fleet is on screen. */
  const [asking, setAsking] = useState<PublicVehicle | null>(null)

  useEffect(() => {
    let current = true
    void fetchBookingPage(slug).then((result) => {
      if (current) setAnswered({ slug, result })
    })
    return () => {
      current = false
    }
  }, [slug])

  const result = answered !== null && answered.slug === slug ? answered.result : null

  const onRequest = useCallback((vehicle: PublicVehicle) => {
    setAsking(vehicle)
  }, [])

  const onCloseForm = useCallback(() => {
    setAsking(null)
  }, [])

  if (result === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4">
        <Spinner />
        <span className="sr-only">Loading</span>
      </main>
    )
  }

  if (result.status === 'not-found') {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-xl font-semibold">This booking page is not available.</h1>
        <p className="text-ink-muted text-sm">
          The address may be wrong, or the agency may not be taking bookings online.
        </p>
      </main>
    )
  }

  if (result.status === 'unavailable') {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-xl font-semibold">We could not load this page.</h1>
        <p className="text-ink-muted text-sm">{result.message}</p>
      </main>
    )
  }

  const { agency, window: period, vehicles } = result.page
  const readable = formatWindow(
    { from: new Date(period.from), to: new Date(period.to) },
    agency.timeZone,
  )

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-center gap-4">
        {agency.logoUrl === null ? null : (
          <img src={agency.logoUrl} alt="" className="h-12 w-12 rounded-md object-contain" />
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{agency.name}</h1>
          <p className="text-ink-muted text-sm">{readable}</p>
        </div>
      </header>

      {agency.acceptsRequests ? null : (
        <div className="border-line bg-surface-muted mb-8 rounded-lg border px-5 py-4">
          {/*
           * The exact words from the design. An agency whose billing has
           * lapsed keeps its page, its fleet and its prices; what it loses is
           * the form. Telephoning still works, and saying so is better than a
           * button that fails.
           */}
          <p className="text-sm font-medium">To book, please call us</p>
          {agency.phone === null ? null : (
            <a href={`tel:${agency.phone.replace(/\s+/g, '')}`} className="text-brand-700 text-sm">
              {agency.phone}
            </a>
          )}
        </div>
      )}

      {asking !== null ? (
        /*
         * The form replaces the fleet rather than opening over it. A visitor
         * on a telephone filling in four fields should not be doing it through
         * a dialog they can dismiss by brushing the screen, and the car, the
         * dates and the estimate are repeated at the top of the form so that
         * what they are asking for is in front of them while they type.
         */
        <RequestForm
          agency={agency}
          vehicle={asking}
          slug={slug}
          period={period}
          onClose={onCloseForm}
        />
      ) : vehicles.length === 0 ? (
        <p className="text-ink-muted text-sm">
          There are no cars on this page at the moment. Please check back, or call the agency.
        </p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((vehicle) => (
            <VehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              onRequest={agency.acceptsRequests ? onRequest : undefined}
            />
          ))}
        </div>
      )}
    </main>
  )
}
