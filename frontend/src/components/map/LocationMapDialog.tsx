// One van's location on a map, with the enabled homes around it (D-049).
// Opened from the table's Location cell and the map button beside the
// popup's Location field. Disabled homes stay off it, so the pins match the
// distance pill.

import { DistanceValue } from '@/components/DistanceValue'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { missingReason } from '@/lib/distance'
import type { Home, Listing } from '@/lib/schema'
import { VanMap } from './VanMap'

interface Props {
  listing: Listing | null
  /** Already narrowed to the enabled ones. */
  homes: Home[]
  onClose: () => void
}

export function LocationMapDialog({ listing, homes, onClose }: Props) {
  return (
    <Dialog open={listing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {listing && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8">{listing.location || 'No location'}</DialogTitle>
              <DialogDescription className="truncate">{listing.title}</DialogDescription>
            </DialogHeader>
            {listing.lat !== null && listing.lng !== null ? (
              <>
                <VanMap
                  className="h-[60svh]"
                  vans={[{ id: listing.id, lat: listing.lat, lng: listing.lng, label: listing.location ?? '' }]}
                  homes={homes}
                />
                <div className="text-sm">
                  <DistanceValue listing={listing} />
                </div>
              </>
            ) : (
              // Same wording as the "—" tooltip: usually "Couldn't place this
              // location — adding a postcode fixes it".
              <p className="py-8 text-center text-muted-foreground">{missingReason(listing)}</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
