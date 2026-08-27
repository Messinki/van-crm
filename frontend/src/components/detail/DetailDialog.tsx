// The listing detail view — the old drawer's content, in a centred dialog.
//
// Sections come from the registry: a field is in here unless it opts out with
// in_drawer: false, and lands in Details unless it names a section. 'Custom'
// isn't a registry section — it's the user-defined properties from
// /api/properties, slotted in between Images and Notes.

import { useRef } from 'react'
import { toast } from 'sonner'

import { useCheckListing, useDeleteListing } from '@/api/queries'
import { RejectButton } from '@/components/table/cells'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { FieldSpec, Listing, PropertyDef, Schema } from '@/lib/schema'
import { openWindow, windowLink } from '@/lib/window'
import { CustomField, EditableField, NotesField, ReadonlyField, RegField } from './DetailFields'
import { MotPanel } from './MotPanel'

const SECTIONS = ['Details', 'Images', 'Custom', 'Notes', 'MOT'] as const

interface Props {
  listing: Listing | null
  schema: Schema
  properties: PropertyDef[]
  onClose: () => void
}

export function DetailDialog({ listing, schema, properties, onClose }: Props) {
  const flushNotes = useRef<() => void>(() => {})

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
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        {listing && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8">{listing.title}</DialogTitle>
            </DialogHeader>
            <DetailBody
              listing={listing}
              schema={schema}
              properties={properties}
              flushNotes={flushNotes}
              onClose={onClose}
            />
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
}: {
  listing: Listing
  schema: Schema
  properties: PropertyDef[]
  flushNotes: React.RefObject<() => void>
  onClose: () => void
}) {
  // The specs a section renders, in registry order.
  const sectionFields = (name: string): FieldSpec[] =>
    schema.fields.filter((f) => f.in_drawer !== false && (f.section || 'Details') === name)

  return (
    // min-w-0: DialogContent is a grid, so without it this item is sized by its
    // widest min-content child — the image strip — and the field grid spills out
    // of the dialog instead of the strip scrolling.
    <div className="min-w-0 space-y-4">
      <DetailActions listing={listing} onClose={onClose} />

      {listing.image_urls.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {listing.image_urls.map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              loading="lazy"
              className="h-24 w-32 shrink-0 cursor-pointer rounded bg-muted object-cover"
              onClick={() => openWindow(src)}
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
function DetailActions({ listing, onClose }: { listing: Listing; onClose: () => void }) {
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

      <RejectButton listing={listing} size="full" />

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
