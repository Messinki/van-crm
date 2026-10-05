// Distance to the closest enabled home (D-047). Straight-line, from the
// coordinates app/geo.py stored on each listing. Computed here rather than
// stored, the way effectivePrice() is for VAT (D-043): switching a home off or
// adding one re-sorts the table with no refetch.

import type { Home, Listing, Nearest } from './schema'

const EARTH_RADIUS_MILES = 3958.8

interface Point {
  lat: number
  lng: number
}

/** Great-circle distance in miles. */
export function haversineMiles(a: Point, b: Point): number {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h))
}

/** The closest of `homes` (already narrowed to the enabled ones), or null when
 *  the listing isn't placed or there's no home to measure to. A tie goes to
 *  the home listed first. */
export function closestHome(listing: Pick<Listing, 'lat' | 'lng'>, homes: Home[]): Nearest | null {
  if (listing.lat === null || listing.lng === null) return null
  const from = { lat: listing.lat, lng: listing.lng }
  let best: Nearest | null = null
  for (const home of homes) {
    const miles = haversineMiles(from, home)
    if (!best || miles < best.miles) best = { miles, home }
  }
  return best
}

/** Every listing with its `nearest` attached — what the table, popup and
 *  filters all read, so the whole app agrees on one figure. */
export function withNearest(listings: Listing[], homes: Home[]): Listing[] {
  const enabled = homes.filter((h) => h.enabled)
  return listings.map((l) => ({ ...l, nearest: closestHome(l, enabled) }))
}

/** Has a location string but no coordinates. */
export function unplaced(listing: Listing): boolean {
  return Boolean(listing.location?.trim()) && listing.lat === null
}

/** Why a listing has no distance, for the "—" tooltip. */
export function missingReason(listing: Listing): string {
  if (!listing.location?.trim()) return 'No location'
  if (listing.lat === null) {
    return listing.geocoded_from === listing.location
      ? "Couldn't place this location — adding a postcode (even just BS5) fixes it"
      : 'Not looked up yet — Retry under Homes'
  }
  return 'No home switched on — add one under Homes'
}
