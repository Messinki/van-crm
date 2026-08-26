// Shared plate-lookup pieces for the manual form and the detail view.

import type { RegLookupResult } from './schema'

// What a plate lookup is allowed to fill in — and only where the field is
// empty, so the user's own typing always stands. Fuel, colour and engine size
// aren't listing fields; they're shown as an informational line instead.
export const LOOKUP_FILLS = [
  'make',
  'model',
  'year',
  'length_code',
  'height_code',
  'mileage',
  'mot_due',
] as const

export function lookupHeadline(result: RegLookupResult): string {
  return [result.make, result.model, result.year].filter(Boolean).join(' ') || 'Found'
}

export function lookupDetailLine(result: RegLookupResult): string {
  return [result.fuel_type, result.colour, result.engine_size ? result.engine_size + 'cc' : null]
    .filter(Boolean)
    .join(' · ')
}
