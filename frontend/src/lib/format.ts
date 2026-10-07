// Formatting helpers ported from app.js — the table, drawer and filter chips all
// share these so a value reads the same everywhere.

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return '£' + Number(value).toLocaleString('en-GB', { maximumFractionDigits: 0 })
}

/** D-043: price_gbp is the listed price; a Plus VAT listing really costs × 1.2.
 *  Everything that shows, sorts, filters, ranks or totals price reads
 *  effectivePrice() (or sortValue(listing, 'price_gbp'), which calls it) —
 *  never price_gbp directly. Only the popup's price box and the "Listed at"
 *  tooltip show the listed figure on purpose (D-051). */
export const VAT_MULTIPLIER = 1.2

export function plusVat(listing: { vat_status?: string | null }): boolean {
  return listing.vat_status === 'plus_vat'
}

export function effectivePrice(listing: { price_gbp: number | null; vat_status?: string | null }): number | null {
  if (listing.price_gbp === null || listing.price_gbp === undefined) return null
  return plusVat(listing) ? Math.round(listing.price_gbp * VAT_MULTIPLIER) : listing.price_gbp
}

export function number(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return Number(value).toLocaleString('en-GB')
}

export function formatReg(reg: string | null | undefined): string {
  if (!reg) return ''
  return reg.length === 7 ? reg.slice(0, 4) + ' ' + reg.slice(4) : reg
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function isoInDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export function todayIso(): string {
  return isoInDays(0)
}

/** An ISO-8601 UTC stamp (db.now_iso()) as local date + time. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** First `words` words of `text`, with an ellipsis if anything was dropped. */
export function truncateWords(text: string | null | undefined, words: number): string {
  const parts = (text || '').split(' ').filter(Boolean)
  if (parts.length <= words) return parts.join(' ')
  return parts.slice(0, words).join(' ') + '…'
}

export function cleanReg(reg: string | null | undefined): string {
  return (reg || '').replace(/\s+/g, '').toUpperCase()
}
