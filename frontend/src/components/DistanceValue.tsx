// "42 mi" + a pill naming the home it was measured to (D-047). One component
// for every place the distance shows — table cell, popup, and the map card to
// come — so they can't disagree. Every home shares one colour (teal); homes
// are told apart by label.

import { missingReason } from '@/lib/distance'
import type { Listing } from '@/lib/schema'
import { cn } from '@/lib/utils'

export function HomePill({ label }: { label: string }) {
  return (
    <span className="max-w-32 truncate rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-teal-800 dark:bg-teal-950 dark:text-teal-300">
      {label}
    </span>
  )
}

/** `aligned` gives the miles a fixed-width slot, so a column of them lines up
 *  however long the pills beside them are. */
export function DistanceValue({ listing, aligned = false }: { listing: Listing; aligned?: boolean }) {
  const nearest = listing.nearest
  const slot = cn(aligned && 'w-14 shrink-0 text-right tabular-nums')
  if (!nearest) {
    return (
      <span className="flex items-center text-muted-foreground" title={missingReason(listing)}>
        <span className={slot}>—</span>
      </span>
    )
  }
  const miles = Math.round(nearest.miles)
  return (
    <span
      className="flex items-center gap-1.5"
      title={`${miles} ${miles === 1 ? 'mile' : 'miles'} in a straight line from ${nearest.home.label} (${nearest.home.postcode})`}
    >
      <span className={slot}>{miles} mi</span>
      <HomePill label={nearest.home.label} />
    </span>
  )
}
