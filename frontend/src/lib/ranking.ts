// Weighted rank scoring, ported from app.js. Price, mileage and distance are
// min–max normalised over the rows currently on screen (D-039), so they're
// computed after filtering; MOT left is on a fixed curve instead (D-054).

import { sortValue } from './filtering'
import type { Listing } from './schema'

export const RANK_FACTORS = ['price', 'mileage', 'length', 'distance', 'mot'] as const
export type RankFactor = (typeof RANK_FACTORS)[number]

export const RANK_LABELS: Record<RankFactor, string> = {
  price: 'Price',
  mileage: 'Mileage',
  length: 'Length',
  distance: 'Distance',
  mot: 'MOT left',
}

export interface Rank {
  enabled: boolean
  weights: Record<RankFactor, number>
  lengthOrder: string[]
}

export const DEFAULT_RANK: Rank = {
  enabled: false,
  // Distance and MOT left start at 0: rank settings saved before they existed
  // restore them from here, so nobody's ranking shifts until they give it weight.
  weights: { price: 40, mileage: 30, length: 30, distance: 0, mot: 0 },
  lengthOrder: ['L3', 'L2', 'L4', 'L1'],
}

export interface ScoreParts {
  price: number
  mileage: number
  length: number
  distance: number
  mot: number
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

/** Days for the MOT curve to get ~63% of the way up; 130 keeps six months at ≈0.8. */
export const MOT_TAU_DAYS = 130
/** From this many days left the MOT score is 1 — a longer MOT is no better. */
export const MOT_FULL_DAYS = 365

/** Score for `days` of MOT left on a fixed curve (D-054), not normalised over the
 *  rows on screen: 0 when expired, rising fast then flattening to 1 at a year. */
export function motCurve(days: number): number {
  if (days <= 0) return 0
  const score =
    (1 - Math.exp(-days / MOT_TAU_DAYS)) / (1 - Math.exp(-MOT_FULL_DAYS / MOT_TAU_DAYS))
  return Math.min(1, score)
}

/** Whole days from today (local) to an ISO date, or null when it isn't one. */
function daysUntil(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Math.round((target - today) / 86_400_000)
}

/** MOT left: the DVSA expiry when cached, else the hand-entered due date;
 *  no date at all is a neutral 0.5 like the other factors. */
function motScore(listing: Listing): number {
  const expiry = (listing.mot && listing.mot.expiry) || listing.mot_due
  const days = expiry ? daysUntil(expiry) : null
  return days === null ? 0.5 : motCurve(days)
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
      mot: motScore(row),
    }
    const total = RANK_FACTORS.reduce((acc, f) => acc + w[f] * parts[f], 0) / sum
    out.set(row.id, { ...parts, total })
  }
  return out
}
