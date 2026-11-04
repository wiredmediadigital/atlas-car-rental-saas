/**
 * Where a car was handed over, and where it came back.
 *
 * Both columns are optional free text, and the form says "Leave blank for your
 * usual desk." That promise was kept in exactly one place: the printed
 * contract, which fell back to the agency's city and nothing else. The rental
 * page and the calendar's quick view both showed an em dash, so a rental
 * collected from the agency's own desk — the ordinary case, and the reason the
 * field is optional — read on screen as though nobody had recorded it.
 *
 * The fallback lives here so the three of them cannot disagree again.
 *
 * It names the agency rather than repeating its postal address. A contract
 * already prints that address in the masthead a few centimetres above, and
 * "Atlas Cars — Casablanca" is what somebody collecting a car would actually
 * say to a taxi driver.
 */

export interface PlaceAgency {
  readonly name: string
  readonly city: string | null
}

export interface PlaceRental {
  readonly pickup_location: string | null
  readonly return_location: string | null
}

/** The agency's own desk, named the way a person would say it aloud. */
export function agencyDesk(agency: PlaceAgency): string {
  const city = agency.city?.trim()
  return city ? `${agency.name} — ${city}` : agency.name
}

/** Where the car is collected. Blank means the agency's own desk. */
export function collectionPlace(rental: PlaceRental, agency: PlaceAgency): string {
  return rental.pickup_location?.trim() || agencyDesk(agency)
}

/**
 * Where the car goes back.
 *
 * Blank means wherever it was collected, which is usually what a one-way box
 * left empty is meant to say — and only then the desk.
 */
export function returnPlace(rental: PlaceRental, agency: PlaceAgency): string {
  return rental.return_location?.trim() || collectionPlace(rental, agency)
}
