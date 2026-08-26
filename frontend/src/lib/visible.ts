// visibleListings() ported from app.js: filter, then rank-sort or column-sort.
// Returns the scores map alongside the rows so the Score cells render from the
// same pass that ordered them (D-039).

import { activeFilters, matchesCondition, sortValue, type FilterableProp, type Filters } from './filtering'
import { rankActive, rankScores, type Rank, type Scores } from './ranking'
import type { Listing } from './schema'

export interface Sort {
  key: string
  dir: 'asc' | 'desc'
}

export const DEFAULT_SORT: Sort = { key: 'id', dir: 'desc' }

export interface ColumnLike {
  key: string
  numeric?: boolean
}

export function visibleListings(
  listings: Listing[],
  filters: Filters,
  rank: Rank,
  sort: Sort,
  props: FilterableProp[],
  columns: ColumnLike[],
): { rows: Listing[]; scores: Scores | null } {
  const conditions = activeFilters(filters, props)
  const statuses = new Set(filters.statuses)
  const rows = listings.filter((l) => {
    if (!filters.showInactive && !l.is_active) return false
    // With no chip picked, rejected rows are out of the way entirely; picking
    // the Rejected chip is how you get one back to un-reject it.
    if (statuses.size ? !statuses.has(l.status) : l.status === 'rejected') return false
    if (filters.q && !(l.title || '').toLowerCase().includes(filters.q.toLowerCase())) return false
    return conditions.every(({ prop, cond }) => matchesCondition(l, prop, cond))
  })

  if (rankActive(rank)) {
    const scores = rankScores(rows, rank)
    rows.sort(
      (a, b) =>
        scores.get(b.id)!.total - scores.get(a.id)!.total ||
        (a.price_gbp ?? Infinity) - (b.price_gbp ?? Infinity) ||
        b.id - a.id,
    )
    return { rows, scores }
  }

  const col = columns.find((c) => c.key === sort.key)
  const sign = sort.dir === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    const va = sortValue(a, sort.key)
    const vb = sortValue(b, sort.key)
    if (va === null && vb === null) return 0
    if (va === null) return 1 // blanks always sink
    if (vb === null) return -1
    if (col && col.numeric) return (Number(va) - Number(vb)) * sign
    return String(va).localeCompare(String(vb), 'en-GB', { numeric: true }) * sign
  })
  return { rows, scores: null }
}
