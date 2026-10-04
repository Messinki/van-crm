// The listing detail view — the old drawer's content, in a centred dialog.
//
// Sections come from the registry: a field is in here unless it opts out with
// in_drawer: false, and lands in Details unless it names a section. 'Custom'
// isn't a registry section — it's the user-defined properties from
// /api/properties, slotted in between Images and Notes.

import { useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { toast } from 'sonner'

import { useCheckListing, useDeleteListing } from '@/api/queries'
import { RejectButton } from '@/components/table/cells'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { FieldSpec, Listing, PropertyDef, Schema } from '@/lib/schema'
import { windowLink } from '@/lib/window'
import { CustomField, EditableField, NotesField, PriceField, ReadonlyField, RegField } from './DetailFields'
import { Gallery } from './Gallery'
import { MotPanel } from './MotPanel'

const SECTIONS = ['Details', 'Images', 'Custom', 'Notes', 'MOT'] as const

interface Props {
  listing: Listing | null
  schema: Schema
  properties: PropertyDef[]
  onClose: () => void
  /** Where the listing sits in the table's current order; null when the
   *  filters hide it, which also leaves it without neighbours. */
  position: { index: number; total: number } | null
  onPrev: (() => void) | null
  onNext: (() => void) | null
  onRejectToggled: () => void
}

export function DetailDialog({
  listing,
  schema,
  properties,
  onClose,
  position,
  onPrev,
  onNext,
  onRejectToggled,
}: Props) {
  const flushNotes = useRef<() => void>(() => {})

  // Which photo the gallery shows; null is the default layout (D-042). Moving
  // to another listing keeps gallery mode, starting at its first photo.
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null)
  const [galleryFor, setGalleryFor] = useState(listing?.id)
  if (galleryFor !== listing?.id) {
    setGalleryFor(listing?.id)
    setGalleryIndex(galleryIndex !== null && listing?.image_urls.length ? 0 : null)
  }
  const images = listing?.image_urls ?? []
  const gallery = galleryIndex !== null && galleryIndex < images.length
  const stepPhoto = (by: number) =>
    setGalleryIndex((i) => (i === null ? i : (i + by + images.length) % images.length))

  // ←/→ flick through listings — or photos, in gallery mode — unless the key is moving a text cursor or
  // driving a dropdown, which have first claim on arrows.
  const open = listing !== null
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable], [role="listbox"], [role="menu"]')) return
      const by = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      if (!by) return
      const go = gallery ? () => stepPhoto(by) : by < 0 ? onPrev : onNext
      if (!go) return
      event.preventDefault()
      go()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Dialog
      open={listing !== null}
      onOpenChange={(open) => {
        if (open) return
        // Don't drop a notes edit that's still inside its debounce.
        flushNotes.current()
        onClose()
      }}
    >
      <DialogContent
        className={
          gallery
            ? 'h-[90svh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-[min(96vw,1600px)]'
            : 'max-h-[90svh] overflow-y-auto sm:max-w-3xl'
        }
        onEscapeKeyDown={(event) => {
          // Esc leaves the gallery first; a second Esc closes the popup.
          if (!gallery) return
          event.preventDefault()
          setGalleryIndex(null)
        }}
      >
        {listing && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 pr-8">
                <Button variant="outline" size="icon-sm" disabled={!onPrev} onClick={() => onPrev?.()} title="Previous listing (←)">
                  <ChevronLeftIcon />
                </Button>
                <Button variant="outline" size="icon-sm" disabled={!onNext} onClick={() => onNext?.()} title="Next listing (→)">
                  <ChevronRightIcon />
                </Button>
                {position && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {position.index + 1} of {position.total}
                  </span>
                )}
              </div>
              <DialogTitle className="pr-8">{listing.title}</DialogTitle>
            </DialogHeader>
            {/* Keyed so moving to another listing remounts the fields: they are
                uncontrolled (D-040), and the unmount flushes any pending notes
                save against the listing being left. */}
            {/* The body sits at the same place in the tree in both layouts, so
                switching layout doesn't remount the fields. */}
            <div className={gallery ? 'grid min-h-0 grid-cols-2 gap-4' : 'min-w-0'}>
              {gallery && (
                <Gallery images={images} index={galleryIndex} onStep={stepPhoto} onClose={() => setGalleryIndex(null)} />
              )}
              <div className={gallery ? 'min-h-0 min-w-0 overflow-y-auto pr-2' : 'min-w-0'}>
                <DetailBody
                  key={listing.id}
                  onRejectToggled={onRejectToggled}
                  listing={listing}
                  schema={schema}
                  properties={properties}
                  flushNotes={flushNotes}
                  onClose={onClose}
                  activeImage={gallery ? galleryIndex : null}
                  onImageClick={setGalleryIndex}
                />
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DetailBody({
  listing,
  schema,
  properties,
  flushNotes,
  onClose,
  onRejectToggled,
  activeImage,
  onImageClick,
}: {
  listing: Listing
  schema: Schema
  properties: PropertyDef[]
  flushNotes: React.RefObject<() => void>
  onClose: () => void
  onRejectToggled: () => void
  /** The photo the gallery is showing, outlined in the strip. */
  activeImage: number | null
  onImageClick: (index: number) => void
}) {
  // The specs a section renders, in registry order.
  const sectionFields = (name: string): FieldSpec[] =>
    schema.fields.filter((f) => f.in_drawer !== false && (f.section || 'Details') === name)

  return (
    // min-w-0: DialogContent is a grid, so without it this item is sized by its
    // widest min-content child — the image strip — and the field grid spills out
    // of the dialog instead of the strip scrolling.
    <div className="min-w-0 space-y-4">
      <DetailActions listing={listing} onClose={onClose} onRejectToggled={onRejectToggled} />

      {listing.image_urls.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {listing.image_urls.map((src, index) => (
            <img
              key={src}
              src={src}
              alt=""
              loading="lazy"
              className={cn(
                'h-24 w-32 shrink-0 cursor-pointer rounded bg-muted object-cover',
                index === activeImage && 'outline-2 -outline-offset-2 outline-primary',
              )}
              onClick={() => onImageClick(index)}
            />
          ))}
        </div>
      )}

      {listing.url && (
        <p>
          <a {...windowLink(listing.url)} className="text-sm text-primary hover:underline">
            Open original listing ↗
          </a>
        </p>
      )}

      {SECTIONS.map((name) => {
        if (name === 'Custom') {
          if (!properties.length) return null
          return (
            <Section key={name} title="Custom">
              <div className="grid grid-cols-2 gap-3">
                {properties.map((prop) => (
                  <CustomField key={prop.key} listing={listing} prop={prop} />
                ))}
              </div>
            </Section>
          )
        }

        const specs = sectionFields(name)
        if (!specs.length) return null
        // Details is a two-column grid; the wide widgets (notes, image URLs)
        // want the full width.
        const grid = name === 'Details'
        return (
          <Section key={name} title={name}>
            <div className={grid ? 'grid grid-cols-2 gap-3' : 'space-y-3'}>
              {specs.map((spec) => (
                <div key={spec.key} className={grid && spec.widget === 'reg_lookup' ? 'col-span-2' : undefined}>
                  <DetailField listing={listing} spec={spec} flushNotes={flushNotes} />
                </div>
              ))}
            </div>
            {/* The DVSA report hangs off the end of the MOT section. */}
            {name === 'MOT' && <MotPanel listing={listing} />}
          </Section>
        )
      })}
    </div>
  )
}

function DetailField({
  listing,
  spec,
  flushNotes,
}: {
  listing: Listing
  spec: FieldSpec
  flushNotes: React.RefObject<() => void>
}) {
  if (spec.widget === 'reg_lookup') return <RegField listing={listing} />
  if (spec.widget === 'notes') return <NotesField listing={listing} flushRef={flushNotes} />
  if (spec.widget === 'price_vat') return <PriceField listing={listing} spec={spec} />
  if (!spec.editable) return <ReadonlyField listing={listing} spec={spec} />
  return <EditableField listing={listing} spec={spec} />
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

/** Whole-listing operations, as opposed to the field editors below them. They
 *  sit at the top because they are what the detail view is opened for as often
 *  as the fields are. Check listing live is eBay-only; the other two always show. */
function DetailActions({
  listing,
  onClose,
  onRejectToggled,
}: {
  listing: Listing
  onClose: () => void
  onRejectToggled: () => void
}) {
  const check = useCheckListing()
  const remove = useDeleteListing()

  return (
    <div className="flex flex-wrap gap-2">
      {listing.source === 'ebay' && (
        <Button
          variant="outline"
          size="sm"
          disabled={check.isPending}
          onClick={() =>
            check.mutate(listing.id, {
              onSuccess: (result) => {
                // The price and the active flag can both move; the mutation puts
                // the listing the check hands back into the cache.
                if (result.active) toast(result.message)
                else toast.error(result.message)
              },
            })
          }
        >
          {check.isPending ? 'Checking…' : 'Check listing live'}
        </Button>
      )}

      <RejectButton listing={listing} size="full" onToggled={onRejectToggled} />

      <Button
        variant="destructive"
        size="sm"
        disabled={remove.isPending}
        onClick={() => {
          if (!confirm('Delete this listing? This cannot be undone.')) return
          remove.mutate(listing.id, {
            onSuccess: () => {
              onClose()
              toast('Listing deleted')
            },
          })
        }}
      >
        Delete
      </Button>
    </div>
  )
}
