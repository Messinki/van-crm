// Weighted rank scoring, ported from app.js. Scores are min–max normalised over
// the rows currently on screen (D-039), so they're computed after filtering.

import { sortValue } from './filtering'
import type { Listing } from './schema'

export const RANK_FACTORS = ['price', 'mileage', 'length', 'distance'] as const
export type RankFactor = (typeof RANK_FACTORS)[number]

export const RANK_LABELS: Record<RankFactor, string> = {
  price: 'Price',
  mileage: 'Mileage',
  length: 'Length',
  distance: 'Distance',
}

export interface Rank {
  enabled: boolean
  weights: Record<RankFactor, number>
  lengthOrder: string[]
}

export const DEFAULT_RANK: Rank = {
  enabled: false,
  // Distance starts at 0: rank settings saved before it existed restore it
  // from here, so nobody's ranking shifts until they give it weight.
  weights: { price: 40, mileage: 30, length: 30, distance: 0 },
  lengthOrder: ['L3', 'L2', 'L4', 'L1'],
}

export interface ScoreParts {
  price: number
  mileage: number
  length: number
  distance: number
  total: number
}

export type Scores = Map<number, ScoreParts>

/** Rank mode only drives the order while it's on and something carries weight. */
export function rankActive(rank: Rank): boolean {
  return rank.enabled && RANK_FACTORS.some((f) => rank.weights[f] > 0)
}

/** Min–max normaliser over `rows` for a numeric field, inverted so less is better.
 *  A row with no value scores a neutral 0.5 rather than winning or losing by default. */
function inverseNormaliser(rows: Listing[], key: string): (listing: Listing) => number {
  // Not a bare Number(): Number(null) is 0, which would score a missing
  // mileage as the lowest — the best — instead of neutral.
  const value = (listing: Listing) => {
    const raw = sortValue(listing, key)
    return raw === null ? NaN : Number(raw)
  }
  const nums: number[] = []
  for (const row of rows) {
    const v = value(row)
    if (Number.isFinite(v)) nums.push(v)
  }
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  return (listing) => {
    const v = value(listing)
    if (!Number.isFinite(v)) return 0.5
    if (!nums.length || max === min) return 1
    return 1 - (v - min) / (max - min)
  }
}

function lengthScore(listing: Listing, order: string[]): number {
  const index = order.indexOf(listing.length_code ?? '')
  if (index < 0) return 0.5
  return order.length < 2 ? 1 : 1 - index / (order.length - 1)
}

export function rankScores(rows: Listing[], rank: Rank): Scores {
  const w = rank.weights
  const sum = RANK_FACTORS.reduce((acc, f) => acc + w[f], 0)
  const price = inverseNormaliser(rows, 'price_gbp')
  const mileage = inverseNormaliser(rows, 'mileage')
  // Closer is better; the unrounded miles to the closest enabled home (D-047).
  const distance = inverseNormaliser(rows, 'distance')
  const out: Scores = new Map()
  for (const row of rows) {
    const parts = {
      price: price(row),
      mileage: mileage(row),
      length: lengthScore(row, rank.lengthOrder),
      distance: distance(row),
    }
    const total = RANK_FACTORS.reduce((acc, f) => acc + w[f] * parts[f], 0) / sum
    out.set(row.id, { ...parts, total })
  }
  return out
}
