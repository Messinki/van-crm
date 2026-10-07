// The detail dialog's field controls, ported from app.js drawerField() and
// friends. Every control is derived from the field spec's `type` (or the custom
// property's), so a new registry field shows up here for free.
//
// Selects and checkboxes are uncontrolled with a `key` on their current value
// (D-040): a change there is the save, and the remount picks up the row the PATCH
// hands back. Text, number and date boxes can't work that way — a save per
// keystroke remounted the box and lost focus — so they go through useCommit()
// instead: the edit is held in the box and saved on blur, Enter, a picked value or
// unmount (D-052).

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLinkIcon, MapPinIcon } from 'lucide-react'

import { useRegLookup, useUpdateListing } from '@/api/queries'
import { DistanceValue } from '@/components/DistanceValue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { lookupErrorText } from '@/components/modals/LookupHint'
import { PlateField } from '@/components/modals/PlateField'
import { suggestId } from '@/components/modals/Suggestions'
import { VatChip, VatTotal } from '@/components/modals/VatToggle'
import { NUMERIC_TYPES, specLabel } from '@/lib/filtering'
import { cleanReg, formatReg, plusVat } from '@/lib/format'
import { LOOKUP_FILLS, type LookupState } from '@/lib/lookup'
import type { FieldSpec, Listing, PropertyDef } from '@/lib/schema'

/** Label + control, the shape every row in the dialog takes. `htmlFor` ties the
 *  two together — the control carries the matching id. */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

const selectClass = 'h-8 w-full rounded-md border bg-transparent px-2 text-sm'

/** PATCH one field of one listing. The mutation writes the row the API hands
 *  back into the listings cache, so the table follows along. */
function useSaveField(listing: Listing) {
  const update = useUpdateListing()
  return (key: string, value: unknown) => update.mutate({ id: listing.id, fields: { [key]: value } })
}

/** True when an input event is a value being picked rather than typed: a
 *  datalist suggestion, a number spinner, a date picker. Chrome sends those as a
 *  plain Event; Safari and Firefox as an InputEvent with insertReplacementText. */
function isPick(event: React.ChangeEvent) {
  const native = event.nativeEvent
  return !(native instanceof InputEvent) || native.inputType === 'insertReplacementText'
}

/** Save-on-commit for an uncontrolled text box (D-052). Typing only marks an edit
 *  in progress; it's saved on blur, on Enter (unless `multiline`), as soon as a
 *  value is picked, and on unmount — which is how Esc, click-outside and moving
 *  to another listing keep it, since the dialog's body is keyed on the listing.
 *
 *  The box isn't keyed on its value, so a save never remounts it. While there's no
 *  edit in progress the saved value is written into it, so a plate lookup filling
 *  the field, or the server tidying what was typed, still shows. */
function useCommit<T extends HTMLInputElement | HTMLTextAreaElement>(
  shown: string,
  commit: (raw: string) => void,
  { multiline = false }: { multiline?: boolean } = {},
) {
  const ref = useRef<T>(null)
  const pending = useRef<string | null>(null)
  const latest = useRef({ shown, commit })
  useEffect(() => {
    latest.current = { shown, commit }
  })

  const flush = () => {
    const raw = pending.current
    pending.current = null
    if (raw !== null && raw !== latest.current.shown) latest.current.commit(raw)
  }

  // Follow the saved value whenever the box isn't holding an edit.
  useEffect(() => {
    const el = ref.current
    if (el && pending.current === null && el.value !== shown) el.value = shown
  }, [shown])

  // Backstop: an edit still in the box when it goes away is saved, not dropped.
  useEffect(() => () => flush(), [])

  /** Note the box's new text; a picked value is saved straight away. */
  const edit = (raw: string, picked = false) => {
    pending.current = raw
    if (picked) flush()
  }

  return {
    edit,
    flush,
    props: {
      ref,
      defaultValue: shown,
      onChange: (e: React.ChangeEvent<T>) => edit(e.target.value, isPick(e)),
      onBlur: flush,
      onKeyDown: (e: React.KeyboardEvent<T>) => {
        if (!multiline && e.key === 'Enter') flush()
      },
    },
  }
}

/** A box's text as the value to save: blank is null. */
const asNumber = (raw: string) => (raw === '' ? null : Number(raw))
const asText = (raw: string) => (raw === '' ? null : raw)

/** One editable control, derived entirely from the field spec's `type`. */
export function EditableField({ listing, spec }: { listing: Listing; spec: FieldSpec }) {
  const save = useSaveField(listing)
  const value = listing[spec.key]
  const id = 'detail-' + spec.key
  const numeric = NUMERIC_TYPES.includes(spec.type)
  const multiline = spec.type === 'urls' || spec.type === 'textarea'
  // `urls` is a list on the listing and newline-separated text in the box; the
  // API takes either, so the raw text goes straight back.
  const shown = spec.type === 'urls' ? ((value as string[] | null) || []).join('\n') : String(value ?? '')
  const box = useCommit<HTMLInputElement & HTMLTextAreaElement>(
    shown,
    (raw) => save(spec.key, multiline ? raw : numeric ? asNumber(raw) : asText(raw)),
    { multiline },
  )

  if (spec.type === 'select') {
    // Same rule as the manual form: a spec with a form_default is never blank,
    // so don't offer a blank the API would reject.
    return (
      <Field label={spec.label} htmlFor={id}>
        <select
          id={id}
          className={selectClass}
          key={String(value ?? '')}
          defaultValue={(value as string | null) ?? ''}
          onChange={(e) => save(spec.key, e.target.value === '' ? null : e.target.value)}
        >
          {!spec.form_default && <option value="" />}
          {(spec.options || []).map((o) => (
            <option key={o} value={o}>
              {specLabel(spec, o)}
            </option>
          ))}
        </select>
      </Field>
    )
  }

  if (spec.type === 'checkbox') {
    return (
      <Label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          key={String(value)}
          defaultChecked={value === true}
          onChange={(e) => save(spec.key, e.target.checked)}
        />
        {spec.label}
      </Label>
    )
  }

  if (multiline) {
    return (
      <Field label={spec.label} htmlFor={id}>
        <Textarea id={id} rows={spec.type === 'urls' ? 4 : 6} placeholder={spec.placeholder} {...box.props} />
      </Field>
    )
  }

  return (
    <Field label={spec.label} htmlFor={id}>
      <Input
        id={id}
        className="h-8"
        type={numeric ? 'number' : spec.type === 'date' ? 'date' : 'text'}
        step={numeric ? '1' : undefined}
        list={spec.suggest ? suggestId(spec.key) : undefined}
        {...box.props}
      />
    </Field>
  )
}

/** Price + the Plus VAT toggle (D-043). The box deliberately reads and edits
 *  the listed price_gbp — it's the one place that should (D-051); the toggle
 *  saves vat_status, and the inc-VAT total shows underneath. */
export function PriceField({ listing, spec }: { listing: Listing; spec: FieldSpec }) {
  const save = useSaveField(listing)
  const id = 'detail-' + spec.key
  const on = plusVat(listing)
  const box = useCommit<HTMLInputElement>(String(listing.price_gbp ?? ''), (raw) => save(spec.key, asNumber(raw)))
  return (
    <Field label={spec.label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          className="h-8"
          type="number"
          step="1"
          {...box.props}
        />
        <VatChip on={on} onToggle={(next) => save('vat_status', next ? 'plus_vat' : null)} />
      </div>
      <VatTotal on={on} listed={listing.price_gbp} />
    </Field>
  )
}

/** Location + a button that opens its map (D-049). Editing the text is what
 *  looks the coordinates up again, so the map follows the box. */
export function LocationField({
  listing,
  spec,
  onShowMap,
}: {
  listing: Listing
  spec: FieldSpec
  onShowMap: (listing: Listing) => void
}) {
  const save = useSaveField(listing)
  const id = 'detail-' + spec.key
  const box = useCommit<HTMLInputElement>(listing.location ?? '', (raw) => save(spec.key, asText(raw)))
  return (
    <Field label={spec.label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <Input id={id} className="h-8" list={spec.suggest ? suggestId(spec.key) : undefined} {...box.props} />
        <Button
          variant="outline"
          size="icon-sm"
          title="Show on a map"
          aria-label="Show on a map"
          disabled={!listing.location}
          onClick={() => onShowMap(listing)}
        >
          <MapPinIcon />
        </Button>
      </div>
    </Field>
  )
}

/** Link + a button that opens it in a new tab. Only http(s) links get the
 *  button enabled, so a half-typed or odd value never opens anything. */
export function UrlField({ listing, spec }: { listing: Listing; spec: FieldSpec }) {
  const save = useSaveField(listing)
  const id = 'detail-' + spec.key
  const saved = (listing[spec.key] as string | null) ?? ''
  const href = saved.trim()
  const openable = /^https?:\/\//i.test(href)
  const box = useCommit<HTMLInputElement>(saved, (raw) => save(spec.key, asText(raw)))
  return (
    <Field label={spec.label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <Input id={id} className="h-8" {...box.props} />
        <Button
          variant="outline"
          size="icon-sm"
          title="Open the link in a new tab"
          aria-label="Open the link in a new tab"
          disabled={!openable}
          onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}
        >
          <ExternalLinkIcon />
        </Button>
      </div>
    </Field>
  )
}

/** A field the API won't let anyone change: shown, but not editable. */
export function ReadonlyField({ listing, spec }: { listing: Listing; spec: FieldSpec }) {
  const value = listing[spec.key]
  const id = 'detail-' + spec.key
  return (
    <Field label={spec.label} htmlFor={id}>
      <Input id={id} className="h-8" disabled value={value === null || value === undefined ? '' : specLabel(spec, String(value))} readOnly />
    </Field>
  )
}

/** Miles to the closest enabled home + its pill, the same as the table
 *  (D-047). Read-only: editing Location is what moves it. */
export function DistanceField({ listing, spec }: { listing: Listing; spec: FieldSpec }) {
  const id = 'detail-' + spec.key
  return (
    <Field label={spec.label} htmlFor={id}>
      <output id={id} className="flex h-8 items-center text-sm">
        <DistanceValue listing={listing} />
      </output>
    </Field>
  )
}

/** Reg + plate lookup. The lookup fills only the fields left empty, saves them
 *  in one PATCH along with the cleaned plate, and warms the MOT cache — so the
 *  panel below reloads its report for free. */
export function RegField({ listing }: { listing: Listing }) {
  const client = useQueryClient()
  const update = useUpdateListing()
  const lookup = useRegLookup()
  const save = useSaveField(listing)
  const [state, setState] = useState<LookupState>({ kind: 'idle' })
  // Saved on commit like the other boxes (D-052); PlateField tidies the text
  // into capitals with the usual space before its blur hands over.
  const plate = useCommit<HTMLInputElement>(formatReg(listing.reg), (raw) => save('reg', raw || null))

  const runLookup = () => {
    const reg = cleanReg(plate.props.ref.current?.value)
    if (!reg) {
      setState({ kind: 'hint', text: 'Enter a number plate first' })
      return
    }
    setState({ kind: 'busy' })
    lookup.mutate(reg, {
      onSuccess: (result) => {
        const fields: Record<string, unknown> = { reg }
        for (const field of LOOKUP_FILLS) {
          if (result[field] && !listing[field]) fields[field] = result[field]
        }
        update.mutate({ id: listing.id, fields })
        // The lookup warmed mot_cache, so the panel's cached report is stale.
        void client.invalidateQueries({ queryKey: ['mot', listing.id] })
        setState({ kind: 'result', result })
      },
      onError: (err) => setState({ kind: 'error', text: lookupErrorText(err) }),
    })
  }

  return (
    <PlateField
      id="detail-reg"
      labelClassName="text-xs text-muted-foreground"
      inputRef={plate.props.ref}
      defaultValue={plate.props.defaultValue}
      onChange={(value) => plate.edit(value)}
      onBlur={plate.flush}
      onKeyDown={plate.props.onKeyDown}
      state={state}
      lookupTitle="Fill in the empty fields from DVSA/DVLA and load the MOT history below"
      onLookup={runLookup}
    />
  )
}

/** Notes: no label, big box, autosaved on a debounce with a Saving…/Saved hint.
 *  Notes absorbed the old read-only description field, so give it room.
 *
 *  `flushRef` is how the dialog gets a pending save out before it closes — the
 *  same job the old drawer's flushNotes() did. */
export function NotesField({
  listing,
  flushRef,
}: {
  listing: Listing
  flushRef: React.RefObject<() => void>
}) {
  const save = useSaveField(listing)
  const [text, setText] = useState(listing.notes || '')
  const [hint, setHint] = useState('')
  const timer = useRef<number | null>(null)
  const pending = useRef<string | null>(null)

  const flush = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (pending.current === null) return
    save('notes', pending.current)
    pending.current = null
    setHint('Saved')
    window.setTimeout(() => setHint(''), 1500)
  }

  // Hand the dialog a way to flush before it closes, kept current every render.
  useEffect(() => {
    flushRef.current = flush
  })
  // Backstop for every other way this can go away.
  useEffect(() => () => flushRef.current(), [flushRef])

  const onChange = (value: string) => {
    setText(value)
    pending.current = value
    setHint('Saving…')
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 800)
  }

  return (
    <div className="space-y-1">
      <Textarea rows={14} value={text} onChange={(e) => onChange(e.target.value)} onBlur={flush} />
      <p className="h-4 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

/** One user-defined property, from /api/properties rather than the registry. */
export function CustomField({ listing, prop }: { listing: Listing; prop: PropertyDef }) {
  const update = useUpdateListing()
  const value = listing.custom[prop.key]
  const id = 'custom-' + prop.key
  const save = (raw: unknown) =>
    update.mutate({ id: listing.id, fields: { custom: { [prop.key]: raw } } })
  const box = useCommit<HTMLInputElement>(String(value ?? ''), (raw) => save(asText(raw)))

  if (prop.type === 'checkbox') {
    return (
      <Label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          key={String(value)}
          defaultChecked={value === true}
          onChange={(e) => save(e.target.checked)}
        />
        {prop.label}
      </Label>
    )
  }

  if (prop.type === 'select') {
    return (
      <Field label={prop.label} htmlFor={id}>
        <select
          id={id}
          className={selectClass}
          key={String(value ?? '')}
          defaultValue={(value as string | null) ?? ''}
          onChange={(e) => save(e.target.value || null)}
        >
          <option value="" />
          {prop.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Field>
    )
  }

  return (
    <Field label={prop.label} htmlFor={id}>
      <Input
        id={id}
        className="h-8"
        type={prop.type === 'number' ? 'number' : prop.type === 'date' ? 'date' : 'text'}
        {...box.props}
      />
    </Field>
  )
}
