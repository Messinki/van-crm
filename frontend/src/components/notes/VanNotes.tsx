// Van-type notes (D-061): the Notes view, where every note is an editable box,
// and the compact list the listing popup shows beside its thumbnails.
//
// Text boxes save on blur/Enter through useCommit() like the popup's fields
// (D-052); ticks and selects save as they're clicked. Every note shows its kind,
// van types and build window; engine, gearbox and mileage are chips added only
// when a note needs them (D-067).

import { useState } from 'react'
import { ChevronDownIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'

import {
  useCreateVanNote,
  useDeleteVanNote,
  useUpdateVanNote,
  useVanNotes,
} from '@/api/queries'
import { useCommit } from '@/components/detail/DetailFields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import type { Listing, Schema, VanNote } from '@/lib/schema'
import { cn } from '@/lib/utils'
import { builtLabel, conditionsLabel, dedupedNotes, matchingNotes, noteScope } from '@/lib/vanNotes'

/* -------------------------------------------------------------- Notes view */

export function NotesView({ schema }: { schema: Schema }) {
  const { data: notes = [], isPending } = useVanNotes()
  const create = useCreateVanNote()

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-3 pb-8">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            What you've learnt about van types. A note shows in a van's popup when its van type is
            ticked and the van fits its build dates and any other conditions; it shows greyed as
            "may apply" when the van's details aren't known.
          </p>
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => create.mutate()}
            disabled={create.isPending}
            title="Add a note"
          >
            <PlusIcon /> Add note
          </Button>
        </div>
        {!isPending && notes.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No notes yet — press Add note to start one.
          </p>
        )}
        {notes.map((note) => (
          <NoteCard key={note.id} note={note} schema={schema} />
        ))}
      </div>
    </div>
  )
}

function useSaveNote(note: VanNote) {
  const update = useUpdateVanNote()
  return (fields: Partial<Omit<VanNote, 'id'>>) => update.mutate({ id: note.id, fields })
}

const BUILT_RE = /^\d{4}(-(0[1-9]|1[0-2]))?$/
const asNumber = (raw: string) => (raw.trim() === '' ? null : Number(raw))
const selectClass = 'h-8 rounded-md border bg-transparent px-2 text-sm'

type Condition = 'engine' | 'gearbox' | 'mileage'
const CONDITION_LABELS: Record<Condition, string> = { engine: 'Engine', gearbox: 'Gearbox', mileage: 'Mileage' }

function setConditions(note: VanNote): Condition[] {
  const out: Condition[] = []
  if (note.engines.length) out.push('engine')
  if (note.gearbox) out.push('gearbox')
  if (note.mileage_min !== null || note.mileage_max !== null) out.push('mileage')
  return out
}

/** A build-date box: a year (2019) or a month (2019-04); anything else isn't saved. */
function BuiltInput({ value, label, onSave }: { value: string | null; label: string; onSave: (v: string | null) => void }) {
  const [bad, setBad] = useState(false)
  const box = useCommit<HTMLInputElement>(value ?? '', (raw) => {
    const v = raw.trim()
    if (v && !BUILT_RE.test(v)) return setBad(true)
    setBad(false)
    onSave(v || null)
  })
  return (
    <Input
      {...box.props}
      placeholder={label === 'Built from' ? 'from' : 'to'}
      aria-label={label}
      title="A year (2019) or a month (2019-04)"
      className={cn('h-8 w-24', bad && 'border-destructive')}
    />
  )
}

function NoteCard({ note, schema }: { note: VanNote; schema: Schema }) {
  const save = useSaveNote(note)
  const remove = useDeleteVanNote()
  // A chip stays once added, even before it has a value; removing it clears it.
  const [added, setAdded] = useState<Condition[]>([])
  const shown = [...new Set([...setConditions(note), ...added])]
  const missing = (Object.keys(CONDITION_LABELS) as Condition[]).filter((c) => !shown.includes(c))
  const drop = (c: Condition) => {
    setAdded((list) => list.filter((x) => x !== c))
    if (c === 'engine') save({ engines: [] })
    if (c === 'gearbox') save({ gearbox: null })
    if (c === 'mileage') save({ mileage_min: null, mileage_max: null })
  }
  const [from, to] = [note.built_from, note.built_to]
  const backwards = from && to && (from.length === 4 ? from + '-01' : from) > (to.length === 4 ? to + '-12' : to)

  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          key={note.kind}
          defaultValue={note.kind}
          aria-label="Kind"
          className={selectClass}
          onChange={(e) => save({ kind: e.target.value as VanNote['kind'] })}
        >
          <option value="fault">Fault</option>
          <option value="recall">Recall</option>
        </select>
        <ModelPicker note={note} schema={schema} onChange={(models) => save({ models })} />
        <span className="ml-1 text-xs text-muted-foreground">Built</span>
        <BuiltInput value={from} label="Built from" onSave={(v) => save({ built_from: v })} />
        <span className="text-muted-foreground">–</span>
        <BuiltInput value={to} label="Built to" onSave={(v) => save({ built_to: v })} />
        {backwards && <span className="text-xs text-destructive">From is after To — matches nothing</span>}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          title="Delete note"
          onClick={() => {
            if (!confirm(`Delete this note (${noteScope(note)})?`)) return
            remove.mutate(note.id)
          }}
        >
          <Trash2Icon />
        </Button>
      </div>
      {(shown.length > 0 || missing.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {shown.includes('engine') && (
            <Chip label="Engine" onRemove={() => drop('engine')}>
              <EnginePicker note={note} schema={schema} onChange={(engines) => save({ engines })} />
            </Chip>
          )}
          {shown.includes('gearbox') && (
            <Chip label="Gearbox" onRemove={() => drop('gearbox')}>
              <select
                key={note.gearbox ?? ''}
                defaultValue={note.gearbox ?? ''}
                aria-label="Gearbox"
                className="h-7 rounded border bg-transparent px-1 text-sm"
                onChange={(e) => save({ gearbox: e.target.value || null })}
              >
                <option value="">choose…</option>
                <option value="manual">Manual</option>
                <option value="automatic">Automatic</option>
              </select>
            </Chip>
          )}
          {shown.includes('mileage') && (
            <Chip label="Mileage" onRemove={() => drop('mileage')}>
              <MileageInputs note={note} onSave={save} />
            </Chip>
          )}
          {missing.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-muted-foreground">
                  <PlusIcon /> Condition
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-40 p-1">
                {missing.map((c) => (
                  <button
                    key={c}
                    className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
                    onClick={() => setAdded((list) => [...list, c])}
                  >
                    {CONDITION_LABELS[c]}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
      <CommentBox
        note={note}
        placeholder={note.kind === 'recall' ? 'One recall per line — the build dates are shown for you' : 'What to look out for…'}
        className="min-h-20"
      />
    </div>
  )
}

function Chip({ label, onRemove, children }: { label: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
      <Button variant="ghost" size="icon-sm" className="size-6" title={`Remove the ${label.toLowerCase()} condition`} onClick={onRemove}>
        <XIcon />
      </Button>
    </span>
  )
}

/** The engines for the ticked van types (all of them if none is ticked). */
function EnginePicker({ note, schema, onChange }: { note: VanNote; schema: Schema; onChange: (engines: string[]) => void }) {
  const known = schema.engines
    .filter((e) => !note.models.length || e.models.some((m) => note.models.includes(m)))
    .map((e) => e.name)
  const names = [...new Set([...known, ...note.engines])]
  const toggle = (name: string, on: boolean) =>
    onChange(on ? [...note.engines, name] : note.engines.filter((e) => e !== name))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 max-w-xs justify-between">
          <span className={cn('truncate', !note.engines.length && 'text-muted-foreground')}>
            {note.engines.length ? note.engines.join(', ') : 'choose…'}
          </span>
          <ChevronDownIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56">
        {names.length === 0 && <p className="text-sm text-muted-foreground">No known engines for these van types yet.</p>}
        {names.map((name) => (
          <label key={name} className="flex items-center gap-2 py-0.5 text-sm">
            <input type="checkbox" checked={note.engines.includes(name)} onChange={(e) => toggle(name, e.target.checked)} />
            {name}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function MileageInputs({ note, onSave }: { note: VanNote; onSave: (fields: Partial<VanNote>) => void }) {
  const min = useCommit<HTMLInputElement>(String(note.mileage_min ?? ''), (raw) => onSave({ mileage_min: asNumber(raw) }))
  const max = useCommit<HTMLInputElement>(String(note.mileage_max ?? ''), (raw) => onSave({ mileage_max: asNumber(raw) }))
  return (
    <>
      <Input {...min.props} type="number" placeholder="over" aria-label="Mileage over" className="h-7 w-24" />
      <span className="text-muted-foreground">–</span>
      <Input {...max.props} type="number" placeholder="under" aria-label="Mileage under" className="h-7 w-24" />
      <span className="text-xs text-muted-foreground">mi</span>
    </>
  )
}

function ModelPicker({
  note,
  schema,
  onChange,
}: {
  note: VanNote
  schema: Schema
  onChange: (models: string[]) => void
}) {
  const toggle = (model: string, on: boolean) =>
    onChange(on ? [...note.models, model] : note.models.filter((m) => m !== model))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-md justify-between">
          <span className={cn('truncate', !note.models.length && 'text-muted-foreground')}>
            {note.models.length ? note.models.join(', ') : 'Choose van types'}
          </span>
          <ChevronDownIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[28rem]">
        {Object.entries(schema.model_families).map(([label, family]) => {
          const all = family.every((m) => note.models.includes(m))
          return (
            <Button
              key={label}
              variant="outline"
              size="sm"
              className="mb-3 w-full"
              title={all ? 'Untick these van types' : 'Tick all of these at once — they are the same van'}
              onClick={() =>
                onChange(all ? note.models.filter((m) => !family.includes(m)) : [...new Set([...note.models, ...family])])
              }
            >
              {all ? 'Untick' : 'Tick'} {label}
            </Button>
          )
        })}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {Object.entries(schema.models).map(([make, models]) => (
            <div key={make}>
              <div className="text-xs font-semibold text-muted-foreground">{make}</div>
              {models.map((model) => (
                <label key={model} className="flex items-center gap-2 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    checked={note.models.includes(model)}
                    onChange={(e) => toggle(model, e.target.checked)}
                  />
                  {model}
                </label>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function CommentBox({
  note,
  placeholder,
  className,
}: {
  note: VanNote
  placeholder?: string
  className?: string
}) {
  const save = useSaveNote(note)
  const box = useCommit<HTMLTextAreaElement>(note.comment, (raw) => save({ comment: raw }), { multiline: true })
  return <Textarea {...box.props} placeholder={placeholder} aria-label="Note" className={className} />
}

/* ------------------------------------------------------- popup (D-061) */

function NoteLines({ lines, suffix }: { lines: string[]; suffix?: string }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-sm">
      {lines.map((line, i) => (
        <li key={i}>
          {line}
          {suffix && <span className="text-muted-foreground"> · {suffix}</span>}
        </li>
      ))}
    </ul>
  )
}

/** The known issues for this van, beside the MOT report. Read-only: a note can
 *  cover many vans, so it's edited on the Notes view, not from one van. Recalls
 *  get their own heading; notes the van's details can't confirm come last,
 *  greyed, with the reason (D-067). */
export function ListingNotes({ listing, schema }: { listing: Listing; schema: Schema }) {
  const { data: notes = [] } = useVanNotes()
  const entries = dedupedNotes(matchingNotes(notes, listing, schema))
  const faults = entries.filter((e) => e.note.kind !== 'recall' && e.match.state === 'yes')
  const recalls = entries.filter((e) => e.note.kind === 'recall')
  const maybes = entries.filter((e) => e.note.kind !== 'recall' && e.match.state === 'maybe')
  const why = (unknown: string[]) => 'may apply — ' + unknown.join(', ')

  return (
    <div className="min-w-0 space-y-3">
      <div className="text-sm font-medium">Known issues</div>
      {entries.length === 0 && <p className="text-sm text-muted-foreground">No notes for this van.</p>}
      {faults.map(({ note, lines }) => (
        <div key={note.id} className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">{noteScope(note)}</div>
          <NoteLines lines={lines} />
        </div>
      ))}
      {recalls.length > 0 && (
        <div className="space-y-1">
          <div className="text-sm font-medium text-muted-foreground">
            Recalls — check the VIN at{' '}
            <a className="underline" href="https://www.themotorombudsman.org/vehicle-recalls" target="_blank" rel="noreferrer">
              the Motor Ombudsman
            </a>
          </div>
          {recalls.map(({ note, lines, match }) => (
            <div key={note.id} className={cn(match.state === 'maybe' && 'opacity-60')} title={match.state === 'maybe' ? why(match.unknown) : undefined}>
              <NoteLines
                lines={lines}
                suffix={['built ' + builtLabel(note), conditionsLabel(note) || null, match.state === 'maybe' ? why(match.unknown) : null]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </div>
          ))}
        </div>
      )}
      {maybes.map(({ note, lines, match }) => (
        <div key={note.id} className="space-y-1 opacity-60">
          <div className="text-sm font-medium text-muted-foreground">
            {noteScope(note)} · <span className="italic">{why(match.unknown)}</span>
          </div>
          <NoteLines lines={lines} />
        </div>
      ))}
    </div>
  )
}
