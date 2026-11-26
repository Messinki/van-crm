// Which van notes apply to a listing (D-061, D-067).

import { enginesNamed, gearboxesNamed } from './keywords'
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

/** What a van is known to be, for matching notes against (D-067). */
export interface VanFacts {
  model: string | null
  /** Build window as 'YYYY-MM' months: exact from DVSA's manufactureDate, else
   *  read from the listed year (a reg year trails the build), else null. */
  built: [string, string] | null
  engine: string | null
  gearbox: string | null
  mileage: number | null
}

export type Source = 'you' | 'DVSA' | 'title' | 'description'
export interface Sourced {
  value: string
  source: Source
}

/** Each source's answer, most trusted first (D-068). A source naming two
 *  different values gives none. */
function ranked(answers: [Source, string[] | string | null | undefined][]): Sourced[] {
  const out: Sourced[] = []
  for (const [source, raw] of answers) {
    const values = Array.isArray(raw) ? raw : raw ? [raw] : []
    if (values.length === 1) out.push({ value: values[0], source })
  }
  return out
}

/** The van's engine by source: typed → DVSA → title → description (D-068). */
export function engineSources(listing: Listing, schema: Schema): Sourced[] {
  const model = listingModel(listing, schema)
  const built = buildRange(listing)
  return ranked([
    ['you', listing.engine],
    ['DVSA', listing.mot?.engine_guess],
    ['title', enginesNamed(listing.title ?? '', model, schema.engines, { title: true, built })],
    ['description', enginesNamed(listing.notes ?? '', model, schema.engines, { built })],
  ])
}

/** When the van was built, as a 'YYYY-MM' range: exact from DVSA's
 *  manufactureDate, else from the listed year — a reg year trails the build, so
 *  July of the year before to the end of that year (D-067) — else null. */
export function buildRange(listing: Listing): [string, string] | null {
  const dvsa = listing.mot?.built?.slice(0, 7)
  if (dvsa) return [dvsa, dvsa]
  return listing.year ? [`${listing.year - 1}-07`, `${listing.year}-12`] : null
}

/** The van's gearbox by source: typed → title → description (D-068). */
export function gearboxSources(listing: Listing): Sourced[] {
  return ranked([
    ['you', listing.gearbox],
    ['title', gearboxesNamed(listing.title ?? '', { title: true })],
    ['description', gearboxesNamed(listing.notes ?? '')],
  ])
}

/** The sources that disagree with the one in use. */
export function disagreeing(sources: Sourced[]): Sourced[] {
  const used = sources[0]
  return used ? sources.filter((s) => !same(s.value, used.value)) : []
}

export function vanFacts(listing: Listing, schema: Schema): VanFacts {
  const built = buildRange(listing)
  const miles = [listing.mileage, listing.mot?.odometer_miles].filter((m): m is number => m != null)
  return {
    model: listingModel(listing, schema),
    built,
    engine: engineSources(listing, schema)[0]?.value ?? null,
    gearbox: gearboxSources(listing)[0]?.value ?? null,
    mileage: miles.length ? Math.max(...miles) : null,
  }
}

/** A note's build window as months; a bare year covers the whole year. */
export function noteWindow(note: VanNote): [string | null, string | null] {
  const from = note.built_from ? (note.built_from.length === 4 ? note.built_from + '-01' : note.built_from) : null
  const to = note.built_to ? (note.built_to.length === 4 ? note.built_to + '-12' : note.built_to) : null
  return [from, to]
}

export interface NoteMatch {
  /** yes: every condition holds; maybe: none fails but some can't be checked. */
  state: 'yes' | 'maybe' | 'no'
  /** Why it's only a maybe: "engine unknown", … */
  unknown: string[]
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Does this note apply to this van? A note with no models or no comment
 *  matches nothing; a van with no model matches nothing. */
export function noteMatch(note: VanNote, van: VanFacts): NoteMatch {
  const no: NoteMatch = { state: 'no', unknown: [] }
  if (!note.comment.trim() || !van.model) return no
  if (!note.models.some((m) => same(m, van.model!))) return no
  const unknown: string[] = []

  const [from, to] = noteWindow(note)
  if (from || to) {
    if (!van.built) unknown.push('build date unknown')
    else {
      const [vanFrom, vanTo] = van.built
      if ((from && vanTo < from) || (to && vanFrom > to)) return no
      if ((from && vanFrom < from) || (to && vanTo > to)) unknown.push('build month unknown')
    }
  }
  if (note.engines.length) {
    if (!van.engine) unknown.push('engine unknown')
    else if (!note.engines.some((e) => same(e, van.engine!))) return no
  }
  if (note.gearbox) {
    if (!van.gearbox) unknown.push('gearbox unknown')
    else if (note.gearbox !== van.gearbox) return no
  }
  if (note.mileage_min !== null || note.mileage_max !== null) {
    if (van.mileage === null) unknown.push('mileage unknown')
    else if (
      (note.mileage_min !== null && van.mileage < note.mileage_min) ||
      (note.mileage_max !== null && van.mileage > note.mileage_max)
    )
      return no
  }
  return { state: unknown.length ? 'maybe' : 'yes', unknown }
}

const months = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7))

/** How specific a note is, for ordering (D-063): fewest models, then most extra
 *  conditions, then the narrowest build window. */
function specificity(note: VanNote): [number, number, number] {
  const [from, to] = noteWindow(note)
  const extras = (note.engines.length ? 1 : 0) + (note.gearbox ? 1 : 0) +
    (note.mileage_min !== null || note.mileage_max !== null ? 1 : 0)
  return [note.models.length, -extras, months(to ?? '2100-12') - months(from ?? '1980-01')]
}

/** The notes for a van: definite matches first, then the maybes, each most
 *  specific first (D-063, D-067). */
export function matchingNotes(
  notes: VanNote[],
  listing: Listing,
  schema: Schema,
): { note: VanNote; match: NoteMatch }[] {
  const van = vanFacts(listing, schema)
  return notes
    .map((note) => ({ note, match: noteMatch(note, van) }))
    .filter(({ match }) => match.state !== 'no')
    .sort((a, b) => {
      if (a.match.state !== b.match.state) return a.match.state === 'yes' ? -1 : 1
      const [x, y] = [specificity(a.note), specificity(b.note)]
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.note.id - b.note.id
    })
}

/** A comment as list items: one per line, a leading bullet or dash dropped. */
export function commentLines(comment: string): string[] {
  return comment
    .split('\n')
    .map((line) => line.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter(Boolean)
}

/** Each matching note's lines, with any line an earlier note already showed
 *  dropped (D-063). A note left with no lines is left out. */
export function dedupedNotes<T extends { note: VanNote }>(entries: T[]): (T & { lines: string[] })[] {
  const seen = new Set<string>()
  return entries
    .map((entry) => {
      const lines = commentLines(entry.note.comment).filter((line) => {
        const key = line.toLowerCase().replace(/\s+/g, ' ')
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      return { ...entry, lines }
    })
    .filter(({ lines }) => lines.length > 0)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (v: string) => (v.length === 4 ? v : `${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}`)

/** "Apr–Jun 2019", "2006–2016", "Oct 2014–Jun 2015", "2019 on", "up to 2013". */
export function builtLabel(note: VanNote): string {
  const { built_from: from, built_to: to } = note
  if (from && to) {
    if (from === to) return monthLabel(from)
    if (from.length === 7 && to.length === 7 && from.slice(0, 4) === to.slice(0, 4))
      return `${MONTHS[Number(from.slice(5, 7)) - 1]}–${monthLabel(to)}`
    return `${monthLabel(from)}–${monthLabel(to)}`
  }
  if (from) return `${monthLabel(from)} on`
  if (to) return `up to ${monthLabel(to)}`
  return 'all years'
}

/** What a note's extra conditions say: "2.2 BlueHDi · automatic · over 90,000 mi". */
export function conditionsLabel(note: VanNote): string {
  const miles = (n: number) => n.toLocaleString('en-GB')
  const mileage =
    note.mileage_min !== null && note.mileage_max !== null
      ? `${miles(note.mileage_min)}–${miles(note.mileage_max)} mi`
      : note.mileage_min !== null
        ? `over ${miles(note.mileage_min)} mi`
        : note.mileage_max !== null
          ? `under ${miles(note.mileage_max)} mi`
          : null
  return [note.engines.join(' / ') || null, note.gearbox, mileage].filter(Boolean).join(' · ')
}

/** "Relay, Boxer · 2014–2016 · 2.2 HDi". */
export function noteScope(note: VanNote): string {
  const models = note.models.length ? note.models.join(', ') : 'No van types'
  const conditions = conditionsLabel(note)
  // "all years" only when nothing else narrows the note.
  const built = note.built_from || note.built_to || !conditions ? builtLabel(note) : null
  return [models, built, conditions || null].filter(Boolean).join(' · ')
}
