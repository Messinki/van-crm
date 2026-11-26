// Which van notes apply to a listing (D-061).

import type { Listing, Schema, VanNote } from './schema'

/** Every known base model, longest first so "Transit Custom" wins over "Transit". */
function modelNames(schema: Schema): string[] {
  return Object.values(schema.models)
    .flat()
    .sort((a, b) => b.length - a.length)
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The listing's base model: its model field, else the first known model its
 *  title names (mirrors normalise.title_model). */
export function listingModel(listing: Listing, schema: Schema): string | null {
  if (listing.model) return listing.model
  const title = listing.title ?? ''
  let best: { name: string; at: number } | null = null
  for (const name of modelNames(schema)) {
    const re = new RegExp(`\\b${escape(name).replace(/ /g, '\\s+')}\\b`, 'i')
    const found = re.exec(title)
    if (found && (best === null || found.index < best.at)) best = { name, at: found.index }
  }
  return best?.name ?? null
}

/** A note applies when the van's model is ticked on it and its year is in range.
 *  A van with no year matches any range; a note with no models or no comment
 *  matches nothing. */
export function noteApplies(note: VanNote, model: string | null, year: number | null): boolean {
  if (!note.comment.trim() || !model) return false
  if (!note.models.some((m) => m.toLowerCase() === model.toLowerCase())) return false
  if (year === null) return true
  if (note.year_min !== null && year < note.year_min) return false
  if (note.year_max !== null && year > note.year_max) return false
  return true
}

export function matchingNotes(notes: VanNote[], listing: Listing, schema: Schema): VanNote[] {
  const model = listingModel(listing, schema)
  return notes.filter((note) => noteApplies(note, model, listing.year))
}

/** "Relay, Boxer · 2014–2016", "Ducato · 2019 on", "Transit · up to 2013". */
export function noteScope(note: VanNote): string {
  const models = note.models.length ? note.models.join(', ') : 'No van types'
  const { year_min: from, year_max: to } = note
  const years =
    from !== null && to !== null
      ? from === to
        ? `${from}`
        : `${from}–${to}`
      : from !== null
        ? `${from} on`
        : to !== null
          ? `up to ${to}`
          : 'all years'
  return `${models} · ${years}`
}
