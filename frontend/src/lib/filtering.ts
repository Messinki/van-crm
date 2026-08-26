// The filter model, ported from app.js (D-039). A filter's key follows the
// column convention: a bare registry field key, or `custom:<slug>`.

import { formatDate, money, number } from './format'
import type { FieldSpec, Listing, PropertyDef, Schema } from './schema'

export const NUMERIC_TYPES = ['number', 'integer', 'money']

export type Condition =
  | { kind: 'range'; min: string | number | null; max: string | number | null }
  | { kind: 'set'; values: string[] }
  | { kind: 'bool'; value: boolean }

export interface Filters {
  statuses: string[]
  q: string
  showInactive: boolean
  props: Record<string, Condition>
}

export const BLANK_FILTERS: Filters = { statuses: [], q: '', showInactive: false, props: {} }

// Registry fields that never get a property filter: the derived display-only
// columns, the two that already own a control in the bar (status has the chips,
// title has the search box), and the ones there is nothing useful to filter on.
const UNFILTERABLE = new Set(['thumb', 'mot', 'reject', 'status', 'image_urls', 'notes', 'url', 'title'])

// A set filter's stand-in for "this listing has no value here". Not a value any
// field could hold, so it can share the selected-values list with real ones.
export const EMPTY_TOKEN = '\u0000empty'

/** A property a filter can be put on — registry field or custom property.
 *  A custom property has no spec, so its options/labels come off itself. */
export interface FilterableProp {
  key: string
  label: string
  type: string
  options: string[]
  spec: FieldSpec | null
}

export function filterableProps(schema: Schema, properties: PropertyDef[]): FilterableProp[] {
  const fields = schema.fields
    .filter((f) => !UNFILTERABLE.has(f.key))
    .map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options || [], spec: f }))
  const custom = properties.map((p) => ({
    key: 'custom:' + p.key,
    label: p.label,
    type: p.type,
    options: p.options || [],
    spec: null,
  }))
  return [...fields, ...custom]
}

/** Pretty label for a select value, from the spec's `labels` map. */
export function specLabel(spec: FieldSpec | null, value: string): string {
  if (!spec) return value
  return (spec.labels && spec.labels[value]) || value
}

/** The sortable/filterable value of a listing under a column key; null for
 *  missing or blank. The MOT cell is an object — it sorts by expiry date. */
export function sortValue(listing: Listing, key: string): string | number | boolean | null {
  if (key === 'id') return listing.id
  if (key === 'mot') return (listing.mot && listing.mot.expiry) || null
  if (key.startsWith('custom:')) {
    const value = listing.custom[key.slice(7)]
    return value === undefined || value === '' ? null : (value as string | number | boolean)
  }
  const value = listing[key]
  return value === undefined || value === '' ? null : (value as string | number | boolean | null)
}

/** Which editor a property's filter uses. Three of these share a stored shape —
 *  see STORED_KIND — because a date range is still a range. */
export function editorKind(prop: FilterableProp): 'range' | 'date' | 'select' | 'bool' | 'text' {
  if (NUMERIC_TYPES.includes(prop.type)) return 'range'
  if (prop.type === 'date') return 'date'
  if (prop.type === 'select') return 'select'
  if (prop.type === 'checkbox') return 'bool'
  return 'text'
}

export const STORED_KIND: Record<string, Condition['kind']> = {
  range: 'range',
  date: 'range',
  select: 'set',
  text: 'set',
  bool: 'bool',
}

export function blankCondition(kind: Condition['kind']): Condition {
  if (kind === 'range') return { kind: 'range', min: null, max: null }
  if (kind === 'set') return { kind: 'set', values: [] }
  return { kind: 'bool', value: true }
}

function boundValue(raw: string | number | null, numeric: boolean): string | number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (!numeric) return String(raw)
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}

export function matchesCondition(listing: Listing, prop: FilterableProp, cond: Condition): boolean {
  const value = sortValue(listing, prop.key) // null for missing or blank

  if (cond.kind === 'range') {
    const numeric = NUMERIC_TYPES.includes(prop.type)
    const lo = boundValue(cond.min, numeric)
    const hi = boundValue(cond.max, numeric)
    if (lo === null && hi === null) return true // an unfilled range filters nothing
    // Notion's rule: once a bound is set, a listing with no value can't satisfy it.
    if (value === null) return false
    if (numeric) {
      const v = Number(value)
      if (Number.isNaN(v)) return false
      if (lo !== null && v < (lo as number)) return false
      if (hi !== null && v > (hi as number)) return false
    } else {
      const v = String(value)
      if (lo !== null && v < (lo as string)) return false
      if (hi !== null && v > (hi as string)) return false
    }
    return true
  }

  if (cond.kind === 'set') {
    if (!cond.values.length) return true
    return cond.values.includes(value === null ? EMPTY_TOKEN : String(value))
  }

  return (value === true) === (cond.value === true)
}

/** The values a text property actually holds across the listings — rebuilt each
 *  time an editor opens. */
export function distinctValues(
  listings: Listing[],
  prop: FilterableProp,
): { values: string[]; hasEmpty: boolean } {
  const seen = new Set<string>()
  let hasEmpty = false
  for (const listing of listings) {
    const value = sortValue(listing, prop.key)
    if (value === null) hasEmpty = true
    else seen.add(String(value))
  }
  const values = Array.from(seen).sort((a, b) =>
    a.localeCompare(b, 'en-GB', { numeric: true, sensitivity: 'base' }),
  )
  return { values, hasEmpty }
}

/** The active filters paired with their property. A filter whose property has
 *  since been deleted is skipped rather than treated as unmatchable. */
export function activeFilters(
  filters: Filters,
  props: FilterableProp[],
): { prop: FilterableProp; cond: Condition }[] {
  const byKey = new Map(props.map((p) => [p.key, p]))
  return Object.entries(filters.props)
    .map(([key, cond]) => ({ prop: byKey.get(key), cond }))
    .filter((f): f is { prop: FilterableProp; cond: Condition } => Boolean(f.prop))
}

/** A property filter's condition in a few characters, for its chip. */
export function conditionSummary(prop: FilterableProp, cond: Condition): string {
  if (cond.kind === 'bool') return cond.value ? 'Checked' : 'Unchecked'

  if (cond.kind === 'set') {
    if (!cond.values.length) return 'any'
    const labels = cond.values.map((v) => (v === EMPTY_TOKEN ? '(empty)' : specLabel(prop.spec, v)))
    return labels.length <= 3 ? labels.join(', ') : labels.slice(0, 2).join(', ') + ' +' + (labels.length - 2)
  }

  const fmt = (v: string | number) =>
    prop.type === 'date'
      ? formatDate(String(v))
      : prop.type === 'money'
        ? money(Number(v))
        : prop.spec && prop.spec.grouped === false
          ? String(v)
          : number(Number(v))
  const lo = cond.min ?? ''
  const hi = cond.max ?? ''
  if (lo !== '' && hi !== '') return fmt(lo) + '–' + fmt(hi)
  if (lo !== '') return '≥ ' + fmt(lo)
  if (hi !== '') return '≤ ' + fmt(hi)
  return 'any'
}
