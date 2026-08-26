// localStorage persistence. Same keys as the old app so saved filters and rank
// settings survive the rebuild. Everything read back may hold a stale shape —
// an old version's keys, a property that's since been deleted, hand-edited
// nonsense. Every restore validates and silently drops what it can't use.

import {
  blankCondition,
  editorKind,
  STORED_KIND,
  type Condition,
  type FilterableProp,
} from './filtering'
import { DEFAULT_RANK, RANK_FACTORS, type Rank } from './ranking'

const LS_FILTERS = 'vancrm.filters'
const LS_RANK = 'vancrm.rank'
const LS_COLUMNS = 'vancrm.columns'

function readStore(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode, full quota */
  }
}

export function saveFilterProps(props: Record<string, Condition>) {
  writeStore(LS_FILTERS, { props })
}

/** Restore the property filters. A filter is only kept if its property still
 *  exists and still has the type the stored condition was written for. */
export function restoreFilterProps(props: FilterableProp[]): Record<string, Condition> {
  const stored = readStore(LS_FILTERS)
  const saved = stored?.props
  if (!saved || typeof saved !== 'object') return {}
  const byKey = new Map(props.map((p) => [p.key, p]))
  const out: Record<string, Condition> = {}
  for (const [key, raw] of Object.entries(saved as Record<string, unknown>)) {
    const prop = byKey.get(key)
    if (!prop || !raw || typeof raw !== 'object') continue
    const cond = raw as { kind?: string; min?: unknown; max?: unknown; values?: unknown; value?: unknown }
    if (cond.kind !== STORED_KIND[editorKind(prop)]) continue
    if (cond.kind === 'range') {
      out[key] = {
        kind: 'range',
        min: (cond.min as string | number | null | undefined) ?? null,
        max: (cond.max as string | number | null | undefined) ?? null,
      }
    } else if (cond.kind === 'set') {
      if (!Array.isArray(cond.values)) continue
      out[key] = { kind: 'set', values: cond.values.filter((v): v is string => typeof v === 'string') }
    } else {
      out[key] = { kind: 'bool', value: cond.value === true }
    }
  }
  return out
}

export function saveRank(rank: Rank) {
  writeStore(LS_RANK, rank)
}

export function restoreRank(): Rank {
  const rank: Rank = {
    enabled: DEFAULT_RANK.enabled,
    weights: { ...DEFAULT_RANK.weights },
    lengthOrder: [...DEFAULT_RANK.lengthOrder],
  }
  const stored = readStore(LS_RANK)
  if (!stored) return rank
  rank.enabled = stored.enabled === true
  const weights = stored.weights
  if (weights && typeof weights === 'object') {
    for (const factor of RANK_FACTORS) {
      const value = Number((weights as Record<string, unknown>)[factor])
      if (Number.isFinite(value)) rank.weights[factor] = Math.min(100, Math.max(0, Math.round(value)))
    }
  }
  // Only a genuine permutation of the codes is usable — a partial list would
  // drop codes out of the scoring altogether.
  const order = stored.lengthOrder
  const codes = rank.lengthOrder
  if (Array.isArray(order) && order.length === codes.length && codes.every((c) => order.includes(c))) {
    rank.lengthOrder = order.slice() as string[]
  }
  return rank
}

/** Column visibility: {key: false} for hidden columns. New columns default on. */
export function saveColumnVisibility(hidden: Record<string, boolean>) {
  writeStore(LS_COLUMNS, { hidden })
}

export function restoreColumnVisibility(): Record<string, boolean> {
  const stored = readStore(LS_COLUMNS)
  const hidden = stored?.hidden
  if (!hidden || typeof hidden !== 'object') return {}
  const out: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(hidden as Record<string, unknown>)) {
    if (value === false) out[key] = false
  }
  return out
}

export { blankCondition }
