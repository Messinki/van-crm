// Homes CRUD (D-047): inline edits save on blur, ↑/↓ renumber every row's
// position, the add row appends. A postcode is looked up as it's saved, so a
// bad one is refused (and the box put back) rather than stored unplaced.
// Underneath, how many vans couldn't be placed, with a Retry.

import { useState } from 'react'
import { toast } from 'sonner'

import {
  useCreateHome,
  useDeleteHome,
  useGeocodeMissing,
  useHomes,
  useUpdateHome,
} from '@/api/queries'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { unplaced } from '@/lib/distance'
import type { Home, Listing } from '@/lib/schema'

interface Props {
  listings: Listing[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function HomesDialog({ listings, open, onOpenChange }: Props) {
  const homes = useHomes()
  const update = useUpdateHome()
  const rows = homes.data ?? []

  // Same as the Columns dialog: swap, then renumber everyone, so the stored
  // positions never have gaps or ties.
  const reorder = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    const reordered = [...rows]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    reordered.forEach((home, i) => update.mutate({ id: home.id, fields: { position: i } }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Homes</DialogTitle>
          <DialogDescription>
            Each van shows its straight-line distance to the closest home that's switched on.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="p-1">Label</th>
                <th className="p-1">Postcode</th>
                <th className="p-1">On</th>
                <th className="p-1">Order</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((home, index) => (
                <HomeRow
                  key={home.id}
                  home={home}
                  first={index === 0}
                  last={index === rows.length - 1}
                  onMove={(delta) => reorder(index, delta)}
                />
              ))}
              <AddRow />
            </tbody>
          </table>
        </div>
        {homes.data && !rows.length && (
          <p className="text-sm text-muted-foreground">
            No homes yet. A full postcode (BS5 6AB) or just the first half (BS5) will do.
          </p>
        )}
        <PlacedNote listings={listings} />
      </DialogContent>
    </Dialog>
  )
}

function HomeRow({
  home,
  first,
  last,
  onMove,
}: {
  home: Home
  first: boolean
  last: boolean
  onMove: (delta: number) => void
}) {
  const update = useUpdateHome()
  const remove = useDeleteHome()

  // A refused edit (blank label, unknown postcode) puts the box back to the
  // saved value; the error itself arrives as a toast.
  const saveOnBlur = (field: 'label' | 'postcode') => (e: React.FocusEvent<HTMLInputElement>) => {
    const el = e.target
    if (el.value.trim() === home[field]) return
    update.mutate({ id: home.id, fields: { [field]: el.value } }, { onError: () => (el.value = home[field]) })
  }

  return (
    <tr>
      <td className="p-1">
        <Input className="h-7" key={home.label} defaultValue={home.label} onBlur={saveOnBlur('label')} />
      </td>
      <td className="p-1">
        {/* Keyed on the saved value: the server tidies the postcode (BS56AB →
            BS5 6AB), and the box should show what it kept. */}
        <Input className="h-7 w-32" key={home.postcode} defaultValue={home.postcode} onBlur={saveOnBlur('postcode')} />
      </td>
      <td className="p-1 text-center">
        <input
          type="checkbox"
          aria-label={`Measure distances to ${home.label}`}
          checked={home.enabled}
          onChange={(e) => update.mutate({ id: home.id, fields: { enabled: e.target.checked } })}
        />
      </td>
      <td className="p-1 whitespace-nowrap">
        <Button variant="ghost" size="sm" className="h-7 px-2" title="Move up" disabled={first} onClick={() => onMove(-1)}>
          ↑
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2" title="Move down" disabled={last} onClick={() => onMove(1)}>
          ↓
        </Button>
      </td>
      <td className="p-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          title="Delete"
          onClick={() => {
            if (!confirm(`Delete home "${home.label}"?`)) return
            remove.mutate(home.id)
          }}
        >
          🗑
        </Button>
      </td>
    </tr>
  )
}

function AddRow() {
  const create = useCreateHome()
  const empty = { label: '', postcode: '' }
  const [values, setValues] = useState(empty)

  // On a refused postcode the values stay put, so it can be corrected.
  const add = () => {
    if (!values.label.trim() || !values.postcode.trim()) return
    create.mutate(values, { onSuccess: () => setValues(empty) })
  }
  const onEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && add()

  return (
    <tr className="border-t">
      <td className="p-1">
        <Input
          className="h-7"
          placeholder="New home, e.g. Bristol"
          value={values.label}
          onChange={(e) => setValues({ ...values, label: e.target.value })}
          onKeyDown={onEnter}
        />
      </td>
      <td className="p-1">
        <Input
          className="h-7 w-32"
          placeholder="BS5 6AB or BS5"
          value={values.postcode}
          onChange={(e) => setValues({ ...values, postcode: e.target.value })}
          onKeyDown={onEnter}
        />
      </td>
      <td className="p-1" colSpan={3}>
        <Button
          size="sm"
          className="h-7"
          disabled={create.isPending || !values.label.trim() || !values.postcode.trim()}
          onClick={add}
        >
          {create.isPending ? 'Looking up…' : 'Add'}
        </Button>
      </td>
    </tr>
  )
}

/** "N vans couldn't be placed". Retry only helps the ones whose lookup never
 *  got an answer (postcodes.io unreachable); a location it didn't recognise is
 *  remembered as such (D-048) and only an edit sends it back. */
function PlacedNote({ listings }: { listings: Listing[] }) {
  const geocode = useGeocodeMissing()
  const missing = listings.filter(unplaced)
  if (!missing.length) {
    return <p className="text-xs text-muted-foreground">Every listing with a location is placed.</p>
  }
  const retryable = missing.filter((l) => l.geocoded_from !== l.location).length
  const unrecognised = [...new Set(missing.filter((l) => l.geocoded_from === l.location).map((l) => l.location))]

  const retry = () =>
    geocode.mutate(undefined, {
      onSuccess: (r) => {
        const parts = [`${r.located} placed`]
        if (r.not_found) parts.push(`${r.not_found} not recognised`)
        if (r.failed) parts.push(`${r.failed} couldn't reach postcodes.io`)
        toast(parts.join(' · '))
      },
    })

  return (
    <div className="space-y-1 border-t pt-3 text-sm">
      <div className="flex items-center gap-2">
        <span>
          {missing.length} {missing.length === 1 ? "van couldn't" : "vans couldn't"} be placed
        </span>
        {retryable > 0 && (
          <Button size="sm" variant="outline" className="h-7" disabled={geocode.isPending} onClick={retry}>
            {geocode.isPending ? 'Retrying…' : 'Retry'}
          </Button>
        )}
      </div>
      {unrecognised.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Not recognised: {unrecognised.join(' · ')}. Edit the van's Location to fix it — adding a
          postcode, even just the first half like BS5, does it.
        </p>
      )}
    </div>
  )
}
