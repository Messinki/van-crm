// The detail dialog's field controls, ported from app.js drawerField() and
// friends. Every control is derived from the field spec's `type` (or the custom
// property's), so a new registry field shows up here for free.
//
// Inputs are uncontrolled with a `key` on their current value: same behaviour as
// the old drawer, where a save re-rendered the drawer from the listing the PATCH
// handed back. A field only remounts when its own value actually changed, so a
// plate lookup filling six fields doesn't disturb the one being typed in.

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useRegLookup, useUpdateListing } from '@/api/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { lookupErrorText, LookupResult } from '@/components/modals/LookupHint'
import { suggestId } from '@/components/modals/Suggestions'
import { NUMERIC_TYPES, specLabel } from '@/lib/filtering'
import { cleanReg, formatReg } from '@/lib/format'
import { LOOKUP_FILLS } from '@/lib/lookup'
import type { FieldSpec, Listing, PropertyDef, RegLookupResult } from '@/lib/schema'

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

/** One editable control, derived entirely from the field spec's `type`. */
export function EditableField({ listing, spec }: { listing: Listing; spec: FieldSpec }) {
  const save = useSaveField(listing)
  const value = listing[spec.key]
  const id = 'detail-' + spec.key

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

  if (spec.type === 'urls' || spec.type === 'textarea') {
    // `urls` is a list on the listing and newline-separated text in the box; the
    // API takes either, so the raw text goes straight back.
    const text = spec.type === 'urls' ? ((value as string[] | null) || []).join('\n') : ((value as string | null) ?? '')
    return (
      <Field label={spec.label} htmlFor={id}>
        <Textarea
          id={id}
          rows={spec.type === 'urls' ? 4 : 6}
          key={text}
          defaultValue={text}
          placeholder={spec.placeholder}
          onChange={(e) => save(spec.key, e.target.value)}
        />
      </Field>
    )
  }

  const numeric = NUMERIC_TYPES.includes(spec.type)
  return (
    <Field label={spec.label} htmlFor={id}>
      <Input
        id={id}
        className="h-8"
        type={numeric ? 'number' : spec.type === 'date' ? 'date' : 'text'}
        step={numeric ? '1' : undefined}
        list={spec.suggest ? suggestId(spec.key) : undefined}
        key={String(value ?? '')}
        defaultValue={(value as string | number | null) ?? ''}
        onChange={(e) => {
          const raw = e.target.value
          save(spec.key, raw === '' ? null : numeric ? Number(raw) : raw)
        }}
      />
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

type LookupState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'hint'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'result'; result: RegLookupResult }

/** Reg + plate lookup. The lookup fills only the fields left empty, saves them
 *  in one PATCH along with the cleaned plate, and warms the MOT cache — so the
 *  panel below reloads its report for free. */
export function RegField({ listing }: { listing: Listing }) {
  const client = useQueryClient()
  const update = useUpdateListing()
  const lookup = useRegLookup()
  const save = useSaveField(listing)
  const [state, setState] = useState<LookupState>({ kind: 'idle' })
  const input = useRef<HTMLInputElement>(null)

  const runLookup = () => {
    const reg = cleanReg(input.current?.value)
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
    <div className="space-y-1">
      <Label htmlFor="detail-reg" className="text-xs text-muted-foreground">
        Number plate
      </Label>
      <div className="flex gap-2">
        <Input
          id="detail-reg"
          ref={input}
          className="h-8 w-40"
          key={listing.reg ?? ''}
          defaultValue={formatReg(listing.reg)}
          onChange={(e) => save('reg', e.target.value || null)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={state.kind === 'busy'}
          title="Fill in the empty fields from DVSA/DVLA and load the MOT history below"
          onClick={runLookup}
        >
          {state.kind === 'busy' ? 'Looking up…' : 'Look up plate'}
        </Button>
      </div>
      {state.kind === 'hint' && <p className="text-xs text-muted-foreground">{state.text}</p>}
      {state.kind === 'error' && <p className="text-xs text-destructive">{state.text}</p>}
      {state.kind === 'result' && <LookupResult result={state.result} />}
    </div>
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
        key={String(value ?? '')}
        defaultValue={(value as string | number | null) ?? ''}
        onChange={(e) => save(e.target.value === '' ? null : e.target.value)}
      />
    </Field>
  )
}
