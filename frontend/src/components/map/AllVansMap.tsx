// The Map half of the Table | Map toggle (D-049): every row the table would
// show, as clustered van pins plus the enabled homes. Clicking a pin opens a
// small card; clicking the card opens the normal detail popup, which steps
// through the table's order as usual.

import { DistanceValue } from '@/components/DistanceValue'
import { effectivePrice, money, plusVat } from '@/lib/format'
import type { Home, Listing } from '@/lib/schema'
import { VanMap } from './VanMap'

function PinCard({ listing, onOpen }: { listing: Listing; onOpen: (id: number) => void }) {
  const src = listing.image_urls[0]
  return (
    // Sized in rem, not by Leaflet's 12px popup font, so it reads like the app.
    <button
      type="button"
      className="flex w-64 cursor-pointer flex-col gap-1.5 text-left text-sm text-foreground"
      title="Open the details"
      onClick={() => onOpen(listing.id)}
    >
      {src ? (
        <img src={src} alt="" className="h-36 w-full rounded object-cover" />
      ) : (
        <div className="h-36 w-full rounded bg-muted" />
      )}
      {listing.price_gbp !== null && (
        <div className="font-semibold">
          {money(effectivePrice(listing))}
          {plusVat(listing) && <span className="ml-1.5 text-xs font-normal text-muted-foreground">inc VAT</span>}
        </div>
      )}
      <div className="line-clamp-2 font-medium">{listing.title}</div>
      <DistanceValue listing={listing} />
    </button>
  )
}

interface Props {
  /** The table's visible rows — same search, chips and filters. */
  rows: Listing[]
  /** Already narrowed to the enabled ones. */
  homes: Home[]
  onOpen: (id: number) => void
}

export function AllVansMap({ rows, homes, onOpen }: Props) {
  const placed = rows.filter((l): l is Listing & { lat: number; lng: number } => l.lat !== null && l.lng !== null)
  const missing = rows.length - placed.length
  const byId = new Map(placed.map((l) => [l.id, l]))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <VanMap
        className="min-h-0 flex-1 border"
        vans={placed.map((l) => ({ id: l.id, lat: l.lat, lng: l.lng, label: l.title }))}
        homes={homes}
        cluster
        renderCard={(id) => <PinCard listing={byId.get(id)!} onOpen={onOpen} />}
      />
      <p className="mt-2 text-sm text-muted-foreground">
        {placed.length} {placed.length === 1 ? 'van' : 'vans'} on the map
        {missing > 0 && ` · ${missing} not on the map (no location, or it couldn't be placed)`}
      </p>
    </div>
  )
}
