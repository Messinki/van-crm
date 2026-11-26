// Van-type notes (D-061): the Notes view, where every note is an editable box,
// and the compact list the listing popup shows beside its thumbnails.
//
// Text boxes save on blur/Enter through useCommit() like the popup's fields
// (D-052); model ticks save as they're clicked.

import { ChevronDownIcon, PlusIcon, Trash2Icon } from 'lucide-react'

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
import { dedupedNotes, matchingNotes, noteScope } from '@/lib/vanNotes'

/* -------------------------------------------------------------- Notes view */

export function NotesView({ schema }: { schema: Schema }) {
  const { data: notes = [], isPending } = useVanNotes()
  const create = useCreateVanNote()

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-3 pb-8">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            What you've learnt about van types. A note shows in a van's popup when its model is ticked
            and its year is in range.
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

const asYear = (raw: string) => (raw.trim() === '' ? null : Number(raw))

function NoteCard({ note, schema }: { note: VanNote; schema: Schema }) {
  const save = useSaveNote(note)
  const remove = useDeleteVanNote()
  const from = useCommit<HTMLInputElement>(String(note.year_min ?? ''), (raw) => save({ year_min: asYear(raw) }))
  const to = useCommit<HTMLInputElement>(String(note.year_max ?? ''), (raw) => save({ year_max: asYear(raw) }))
  const backwards = note.year_min !== null && note.year_max !== null && note.year_min > note.year_max

  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ModelPicker note={note} schema={schema} onChange={(models) => save({ models })} />
        <span className="ml-2 text-xs text-muted-foreground">Years</span>
        <Input {...from.props} type="number" placeholder="from" aria-label="From year" className="h-8 w-20" />
        <span className="text-muted-foreground">–</span>
        <Input {...to.props} type="number" placeholder="to" aria-label="To year" className="h-8 w-20" />
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
      <CommentBox note={note} placeholder="What to look out for…" className="min-h-20" />
    </div>
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

function NoteLines({ lines }: { lines: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-sm">
      {lines.map((line, i) => (
        <li key={i} className={/^src:/i.test(line) ? 'list-none -ml-4 text-muted-foreground' : undefined}>
          {line}
        </li>
      ))}
    </ul>
  )
}

/** The known issues for this van, beside the MOT report. Read-only: a note can
 *  cover many vans, so it's edited on the Notes view, not from one van. */
export function ListingNotes({ listing, schema }: { listing: Listing; schema: Schema }) {
  const { data: notes = [] } = useVanNotes()
  const matching = dedupedNotes(matchingNotes(notes, listing, schema))

  return (
    <div className="min-w-0 space-y-3">
      <div className="text-sm font-medium">Known issues</div>
      {matching.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes for this van type and year.</p>
      ) : (
        matching.map(({ note, lines }) => (
          <div key={note.id} className="space-y-1">
            <div className="text-sm font-medium text-muted-foreground">{noteScope(note)}</div>
            <NoteLines lines={lines} />
          </div>
        ))
      )}
    </div>
  )
}
